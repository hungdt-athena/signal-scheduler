const express = require('express');
const schedule = require('node-schedule');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const dataFile = path.join(__dirname, 'schedules.json');

// Helper to read schedules
function getSchedules() {
  if (!fs.existsSync(dataFile)) {
    return [];
  }
  try {
    const data = fs.readFileSync(dataFile, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Error reading schedules:', err);
    return [];
  }
}

// Helper to save schedules
function saveSchedules(schedules) {
  try {
    fs.writeFileSync(dataFile, JSON.stringify(schedules, null, 2), 'utf8');
  } catch (err) {
    console.error('Error saving schedules:', err);
  }
}

// Global store for active schedule jobs
const activeJobs = {};

// Function to trigger webhook
async function triggerWebhook(webhookUrl, id) {
  try {
    console.log(`[${new Date().toISOString()}] Triggering webhook for schedule ${id}: ${webhookUrl}`);
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: "Triggered from Replit Scheduler", scheduleId: id, timestamp: new Date().toISOString() })
    });
    console.log(`[${new Date().toISOString()}] Webhook response status: ${response.status}`);
  } catch (err) {
    console.error(`Error triggering webhook ${webhookUrl}:`, err.message);
  } finally {
    // Remove completed job from store
    delete activeJobs[id];
    
    // Update data file (remove past jobs)
    let schedules = getSchedules();
    schedules = schedules.filter(s => s.id !== id);
    saveSchedules(schedules);
  }
}

// Function to schedule a single job
function scheduleJob(id, targetTime, webhookUrl) {
  const date = new Date(targetTime);
  
  // If time has passed, remove from list and don't execute
  if (date < new Date()) {
    console.log(`Skipping past schedule ${id}`);
    return;
  }

  console.log(`Scheduling job ${id} for ${date.toISOString()} -> ${webhookUrl}`);
  
  const job = schedule.scheduleJob(date, function() {
    triggerWebhook(webhookUrl, id);
  });
  
  if (job) {
    activeJobs[id] = job;
  }
}

// Initialize: Load schedules on startup
function initSchedules() {
  const schedules = getSchedules();
  let validSchedules = [];
  
  schedules.forEach(item => {
    const date = new Date(item.targetTime);
    if (date >= new Date()) {
      scheduleJob(item.id, item.targetTime, item.webhookUrl);
      validSchedules.push(item);
    }
  });
  
  // Cleanup past schedules from file
  if (validSchedules.length !== schedules.length) {
    saveSchedules(validSchedules);
  }
}

initSchedules();

// API Endpoints
app.get('/api/schedules', (req, res) => {
  const schedules = getSchedules();
  res.json(schedules);
});

app.post('/api/schedules', (req, res) => {
  const { targetTime, webhookUrl } = req.body;
  
  if (!targetTime || !webhookUrl) {
    return res.status(400).json({ error: 'targetTime and webhookUrl are required' });
  }

  const date = new Date(targetTime);
  if (isNaN(date.getTime()) || date <= new Date()) {
    return res.status(400).json({ error: 'Invalid or past targetTime' });
  }

  const newSchedule = {
    id: uuidv4(),
    targetTime: date.toISOString(),
    webhookUrl,
    createdAt: new Date().toISOString()
  };

  const schedules = getSchedules();
  schedules.push(newSchedule);
  saveSchedules(schedules);

  scheduleJob(newSchedule.id, newSchedule.targetTime, newSchedule.webhookUrl);

  res.status(201).json(newSchedule);
});

app.delete('/api/schedules/:id', (req, res) => {
  const id = req.params.id;
  
  // Cancel active job
  if (activeJobs[id]) {
    activeJobs[id].cancel();
    delete activeJobs[id];
  }
  
  let schedules = getSchedules();
  const initialLength = schedules.length;
  schedules = schedules.filter(s => s.id !== id);
  
  if (schedules.length !== initialLength) {
    saveSchedules(schedules);
    res.json({ success: true, message: 'Schedule removed' });
  } else {
    res.status(404).json({ error: 'Schedule not found' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Scheduler running on port ${PORT}`);
});
