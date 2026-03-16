const express = require('express');
const schedule = require('node-schedule');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const dataFile = path.join(__dirname, 'schedules.json');
const logsFile = path.join(__dirname, 'logs.json');

function getJson(file) {
  if (!fs.existsSync(file)) return [];
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { return []; }
}
function saveJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function getSchedules() { return getJson(dataFile); }
function saveSchedules(data) { saveJson(dataFile, data); }
function getLogs() { return getJson(logsFile); }
function addLog(log) {
    const logs = getLogs();
    logs.unshift(log);
    if (logs.length > 50) logs.pop();
    saveJson(logsFile, logs);
}

const activeJobs = {};

function cancelJob(id) {
    if (activeJobs[id]) {
        activeJobs[id].cancel();
        delete activeJobs[id];
    }
}

async function triggerWebhook(id) {
    const schedules = getSchedules();
    const sch = schedules.find(s => s.id === id);
    if (!sch || !sch.isActive) return;

    let status = 'Success';
    let responseData = '';
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);
        const res = await fetch(sch.webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: "Triggered from Signal Scheduler", scheduleName: sch.name }),
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        responseData = `Status: ${res.status}`;
        if (!res.ok) status = 'Failed';
    } catch (e) {
        status = 'Failed';
        responseData = e.message;
    }

    addLog({
        id: uuidv4(),
        scheduleId: id,
        scheduleName: sch.name,
        time: new Date().toISOString(), // Raw UTC, formatted later
        webhookUrl: sch.webhookUrl,
        status,
        response: responseData
    });

    if (sch.type === 'once') {
        sch.isActive = false;
        saveSchedules(schedules);
        // Do not reschedule
    } else if (sch.type === 'minutes' || sch.type === 'hours') {
        // Need to recreate the node-schedule job for the next interval
        scheduleJob(sch);
    }
}

function scheduleJob(sch) {
    cancelJob(sch.id);
    if (!sch.isActive) return;

    let rule;
    const now = Date.now();

    try {
        if (sch.type === 'once') {
            const date = new Date(sch.params.targetTime + "+07:00"); // Forces UTC+7 timezone correctly
            if (date.getTime() <= now) {
                sch.isActive = false;
                return; // don't schedule past
            }
            rule = date;
        } else if (sch.type === 'minutes') {
            const interval = sch.params.value * 60 * 1000;
            const start = new Date(sch.createdAt).getTime();
            let nextDate = start + Math.floor((now - start) / interval) * interval;
            if (nextDate <= now) nextDate += interval;
            rule = new Date(nextDate);
        } else if (sch.type === 'hours') {
            const interval = sch.params.value * 60 * 60 * 1000;
            const start = new Date(sch.createdAt).getTime();
            let nextDate = start + Math.floor((now - start) / interval) * interval;
            if (nextDate <= now) nextDate += interval;
            rule = new Date(nextDate);
        } else if (sch.type === 'daily') {
            const [hh, mm] = sch.params.time.split(':');
            rule = new schedule.RecurrenceRule();
            rule.tz = 'Asia/Ho_Chi_Minh';
            rule.hour = parseInt(hh, 10);
            rule.minute = parseInt(mm, 10);
        } else if (sch.type === 'weekly') {
            const [hh, mm] = (sch.params.time || '00:00').split(':');
            rule = new schedule.RecurrenceRule();
            rule.tz = 'Asia/Ho_Chi_Minh';
            rule.dayOfWeek = parseInt(sch.params.weekday || 0, 10);
            rule.hour = parseInt(hh, 10);
            rule.minute = parseInt(mm, 10);
        }
    } catch(err) {
        console.error("Error creating schedule rule:", err);
        return;
    }

    if (rule) {
        console.log(`Scheduling Job ID: ${sch.id} with rule:`, rule);
        activeJobs[sch.id] = schedule.scheduleJob(rule, () => triggerWebhook(sch.id));
    }
}

function initSchedules() {
    const schedules = getSchedules();
    let madeChanges = false;
    schedules.forEach(s => {
        if (s.isActive) scheduleJob(s);
    });
}
initSchedules();

// API Endpoints
app.get('/api/schedules', (req, res) => {
    res.json(getSchedules());
});

app.post('/api/schedules', (req, res) => {
    const { name, type, params, webhookUrl } = req.body;
    
    const newSchedule = {
        id: uuidv4(),
        name,
        type,
        params,
        webhookUrl,
        isActive: true,
        createdAt: new Date().toISOString()
    };

    const schedules = getSchedules();
    schedules.push(newSchedule);
    saveSchedules(schedules);
    scheduleJob(newSchedule);

    res.status(201).json(newSchedule);
});

app.put('/api/schedules/:id', (req, res) => {
    const { name, type, params, webhookUrl, isActive } = req.body;
    const schedules = getSchedules();
    const index = schedules.findIndex(s => s.id === req.params.id);
    if (index === -1) return res.status(404).json({ error: 'Not found' });

    schedules[index] = {
        ...schedules[index],
        name, type, params, webhookUrl, isActive
    };
    saveSchedules(schedules);
    scheduleJob(schedules[index]);
    
    res.json(schedules[index]);
});

app.put('/api/schedules/:id/toggle', (req, res) => {
    const schedules = getSchedules();
    const sch = schedules.find(s => s.id === req.params.id);
    if (!sch) return res.status(404).json({ error: 'Not found' });

    sch.isActive = req.body.isActive;
    saveSchedules(schedules);
    
    if (sch.isActive) scheduleJob(sch);
    else cancelJob(sch.id);

    res.json(sch);
});

app.delete('/api/schedules/:id', (req, res) => {
    const id = req.params.id;
    cancelJob(id);
    let schedules = getSchedules().filter(s => s.id !== id);
    saveSchedules(schedules);
    res.json({ success: true });
});

app.get('/api/logs', (req, res) => {
    res.json(getLogs());
});

app.delete('/api/logs', (req, res) => {
    saveJson(logsFile, []);
    res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Scheduler running on port ${PORT}`);
});
