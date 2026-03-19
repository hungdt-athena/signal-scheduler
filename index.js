const express = require('express');
const schedule = require('node-schedule');
const { v4: uuidv4 } = require('uuid');
const db = require('./db');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const activeJobs = {};

function cancelJob(id) {
    if (activeJobs[id]) {
        activeJobs[id].cancel();
        delete activeJobs[id];
    }
}

async function triggerWebhook(id) {
    console.log(`[TRIGGER] Firing webhook for schedule ${id}`);
    const sch = await db.getScheduleById(id);
    if (!sch) { console.error(`[TRIGGER] Schedule ${id} not found in DB — skipping`); return; }
    if (!sch.is_active) { console.log(`[TRIGGER] Schedule ${id} (${sch.name}) is inactive — skipping`); return; }

    let status = 'Success';
    let responseData = '';
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);
        const res = await fetch(sch.webhook_url, {
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

    await db.addLog({
        id: uuidv4(),
        schedule_id: id,
        schedule_name: sch.name,
        group_name: sch.group_name || 'General',
        time: new Date().toISOString(),
        webhook_url: sch.webhook_url,
        status,
        response: responseData
    });

    if (sch.type === 'once') {
        await db.updateSchedule(id, { is_active: false });
    } else if (sch.type === 'minutes' || sch.type === 'hours') {
        scheduleJob(sch);
    }
}

function scheduleJob(sch) {
    cancelJob(sch.id);
    if (!sch.is_active) return;

    let rule;
    const now = Date.now();

    try {
        if (sch.type === 'once') {
            const date = new Date(sch.params.targetTime + "+07:00");
            if (date.getTime() <= now) {
                db.updateSchedule(sch.id, { is_active: false }).catch(console.error);
                return;
            }
            rule = date;
        } else if (sch.type === 'minutes') {
            const interval = sch.params.value * 60 * 1000;
            let nextDate;
            if (sch.params.initialStartAt) {
                const start = new Date(sch.params.initialStartAt + "+07:00").getTime();
                if (now < start) {
                    nextDate = start;
                } else {
                    nextDate = start + Math.ceil((now - start) / interval) * interval;
                    if (nextDate <= now) nextDate += interval;
                }
            } else {
                const hourStart = new Date(now).setMinutes(0,0,0);
                nextDate = hourStart + Math.ceil((now - hourStart) / interval) * interval;
                if (nextDate <= now) nextDate += interval;
            }
            rule = new Date(nextDate);
        } else if (sch.type === 'hours') {
            const interval = sch.params.value * 60 * 60 * 1000;
            let nextDate;
            if (sch.params.initialStartAt) {
                const start = new Date(sch.params.initialStartAt + "+07:00").getTime();
                if (now < start) {
                    nextDate = start;
                } else {
                    nextDate = start + Math.ceil((now - start) / interval) * interval;
                    if (nextDate <= now) nextDate += interval;
                }
            } else {
                const vnNow = new Date(now + 7 * 3600000);
                const vnDayStart = new Date(vnNow).setUTCHours(0,0,0,0);
                const dayStartUtc = vnDayStart - 7 * 3600000;
                nextDate = dayStartUtc + Math.ceil((now - dayStartUtc) / interval) * interval;
                if (nextDate <= now) nextDate += interval;
            }
            rule = new Date(nextDate);
        } else if (sch.type === 'daily') {
            const [hh, mm] = sch.params.time.split(':');
            rule = new schedule.RecurrenceRule();
            rule.tz = 'Asia/Ho_Chi_Minh';
            rule.hour = parseInt(hh, 10);
            rule.minute = parseInt(mm, 10);
            rule.second = 0;
        } else if (sch.type === 'weekly') {
            const [hh, mm] = (sch.params.time || '00:00').split(':');
            rule = new schedule.RecurrenceRule();
            rule.tz = 'Asia/Ho_Chi_Minh';
            rule.dayOfWeek = parseInt(sch.params.weekday || 0, 10);
            rule.hour = parseInt(hh, 10);
            rule.minute = parseInt(mm, 10);
            rule.second = 0;
        }
    } catch(err) {
        console.error("Error creating schedule rule:", err);
        return;
    }

    if (rule) {
        console.log(`Scheduling Job ID: ${sch.id} (${sch.type}) with rule:`, rule);
        const job = schedule.scheduleJob(rule, () => triggerWebhook(sch.id));
        if (!job) {
            console.error(`[SCHEDULER] FAILED to register job for ${sch.id} (${sch.name}) — node-schedule rejected rule:`, rule);
        } else {
            console.log(`[SCHEDULER] Job registered OK for ${sch.id} (${sch.name}), next: ${job.nextInvocation()}`);
            activeJobs[sch.id] = job;
        }
    }
}

async function initSchedules() {
    const schedules = await db.getSchedules();
    schedules.forEach(s => {
        if (s.is_active) scheduleJob(s);
    });
}
initSchedules();

// ── API ────────────────────────────────────────────────────────────────────

app.get('/api/groups', async (req, res) => {
    const groups = await db.getGroups();
    res.json(groups);
});

app.get('/api/schedules', async (req, res) => {
    const schedules = await db.getSchedules();
    res.json(schedules);
});

app.post('/api/schedules', async (req, res) => {
    const { name, type, params, webhook_url, group_name } = req.body;

    const group_id = await db.findOrCreateGroup(group_name || 'General');

    const newSchedule = {
        id: uuidv4(),
        name,
        type,
        params,
        webhook_url,
        group_id,
        is_active: true,
        created_at: new Date().toISOString()
    };

    const created = await db.createSchedule(newSchedule);
    scheduleJob(created);
    res.status(201).json(created);
});

app.put('/api/schedules/:id', async (req, res) => {
    const { name, type, params, webhook_url, is_active, group_name } = req.body;

    const updates = { name, type, params, webhook_url, is_active };
    if (group_name) {
        updates.group_id = await db.findOrCreateGroup(group_name);
    }

    const updated = await db.updateSchedule(req.params.id, updates);
    if (!updated) return res.status(404).json({ error: 'Not found' });

    scheduleJob(updated);
    res.json(updated);
});

app.put('/api/schedules/:id/toggle', async (req, res) => {
    const sch = await db.getScheduleById(req.params.id);
    if (!sch) return res.status(404).json({ error: 'Not found' });

    const updated = await db.updateSchedule(req.params.id, { is_active: req.body.isActive });

    if (updated.is_active) scheduleJob(updated);
    else cancelJob(updated.id);

    res.json(updated);
});

app.delete('/api/schedules/:id', async (req, res) => {
    const id = req.params.id;
    cancelJob(id);
    await db.deleteSchedule(id);
    res.json({ success: true });
});

app.get('/api/logs', async (req, res) => {
    const logs = await db.getLogs(req.query.group || null);
    res.json(logs);
});

app.delete('/api/logs', async (req, res) => {
    await db.clearLogs();
    res.json({ success: true });
});

app.get('/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Scheduler running on port ${PORT}`);

    // Keep-alive: ping self every 4 minutes to prevent Cloud Run from scaling to zero
    const selfUrl = process.env.APP_URL;
    if (selfUrl) {
        setInterval(() => {
            fetch(`${selfUrl}/health`)
                .then(() => console.log('[KEEPALIVE] ping ok'))
                .catch(e => console.error('[KEEPALIVE] ping failed:', e.message));
        }, 4 * 60 * 1000);
        console.log(`[KEEPALIVE] Self-ping enabled → ${selfUrl}/health`);
    } else {
        console.warn('[KEEPALIVE] APP_URL not set — server may be killed by Cloud Run when idle');
    }
});
