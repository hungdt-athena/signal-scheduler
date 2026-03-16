document.addEventListener('DOMContentLoaded', () => {
    // UI Elements
    const form = document.getElementById('schedule-form');
    const typeSelect = document.getElementById('schedule-type');
    const paramGroups = document.querySelectorAll('.param-group');
    const messageEl = document.getElementById('form-message');
    const listContainer = document.getElementById('schedules-list');
    const template = document.getElementById('schedule-template');
    const logsContainer = document.getElementById('logs-list');
    const logTemplate = document.getElementById('log-template');

    // Tabs
    const tabSchedules = document.getElementById('tab-schedules');
    const tabLogs = document.getElementById('tab-logs');
    const viewSchedules = document.getElementById('view-schedules');
    const viewLogs = document.getElementById('view-logs');

    // State
    let isEditing = false;
    let autoRefreshInterval;

    // Initialization
    function init() {
        const now = new Date();
        now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
        document.getElementById('param-once-time').min = now.toISOString().slice(0, 16);
        
        switchTab('schedules');
    }

    // Tabs Logic
    tabSchedules.addEventListener('click', () => switchTab('schedules'));
    tabLogs.addEventListener('click', () => switchTab('logs'));

    function switchTab(tab) {
        clearInterval(autoRefreshInterval);
        
        if (tab === 'schedules') {
            tabSchedules.classList.add('active');
            tabLogs.classList.remove('active');
            viewSchedules.classList.remove('hidden');
            viewLogs.classList.add('hidden');
            fetchSchedules();
            autoRefreshInterval = setInterval(fetchSchedules, 30000);
        } else {
            tabLogs.classList.add('active');
            tabSchedules.classList.remove('active');
            viewLogs.classList.remove('hidden');
            viewSchedules.classList.add('hidden');
            fetchLogs();
            autoRefreshInterval = setInterval(fetchLogs, 15000);
        }
    }

    // Dynamic Form Fields
    typeSelect.addEventListener('change', (e) => {
        paramGroups.forEach(el => el.classList.add('hidden'));
        document.getElementById(`param-${e.target.value}`).classList.remove('hidden');
    });

    // Submitting Form
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const type = typeSelect.value;
        const params = {};

        // Validation & Params Builder
        if (type === 'once') {
            const t = document.getElementById('param-once-time').value;
            if (!t) return showMessage('Time is required', 'error');
            if (new Date(t) <= new Date()) return showMessage('Must be a future time', 'error');
            params.targetTime = t;
        } else if (type === 'minutes') {
            const v = document.getElementById('param-minutes-val').value;
            if (!v || v < 1) return showMessage('Valid minute interval required', 'error');
            params.value = parseInt(v, 10);
        } else if (type === 'hours') {
            const v = document.getElementById('param-hours-val').value;
            if (!v || v < 1) return showMessage('Valid hour interval required', 'error');
            params.value = parseInt(v, 10);
        } else if (type === 'daily') {
            const t = document.getElementById('param-daily-time').value;
            if (!t) return showMessage('Time is required', 'error');
            params.time = t;
        } else if (type === 'weekly') {
            const d = document.getElementById('param-weekly-day').value;
            const t = document.getElementById('param-weekly-time').value || '00:00';
            params.weekday = d;
            params.time = t;
        }

        const payload = {
            name: document.getElementById('schedule-name').value,
            type: type,
            params: params,
            webhookUrl: document.getElementById('webhook-url').value
        };

        const id = document.getElementById('edit-id').value;
        setLoading(true);
        messageEl.classList.add('hidden');
        
        try {
            let res;
            if (isEditing) {
                payload.isActive = true;
                res = await fetch(`/api/schedules/${id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
            } else {
                res = await fetch('/api/schedules', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
            }
            
            if (res.ok) {
                showMessage(isEditing ? 'Schedule updated!' : 'Schedule created!', 'success');
                resetForm();
                fetchSchedules();
            } else {
                const err = await res.json();
                showMessage(err.error || 'Operation failed', 'error');
            }
        } catch (err) {
            showMessage('Network error', 'error');
        } finally {
            setLoading(false);
        }
    });

    // Formatting Helpers
    function getScheduleDescription(sch) {
        if (sch.type === 'once') return `Once: ${new Date(sch.params.targetTime).toLocaleString('en-US', {month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'})}`;
        if (sch.type === 'minutes') return `Every ${sch.params.value} mins`;
        if (sch.type === 'hours') return `Every ${sch.params.value} hours`;
        if (sch.type === 'daily') return `Daily at ${sch.params.time}`;
        if (sch.type === 'weekly') {
            const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
            return `Weekly: ${days[sch.params.weekday]} at ${sch.params.time}`;
        }
        return 'Unknown';
    }

    // Schedules List
    async function fetchSchedules() {
        if (!viewSchedules.classList.contains('hidden')) {
            try {
                const res = await fetch('/api/schedules');
                const data = await res.json();
                renderSchedules(data);
            } catch (err) {
                listContainer.innerHTML = '<div class="empty-state">Failed to connect to server</div>';
            }
        }
    }

    function renderSchedules(schedules) {
        listContainer.innerHTML = '';
        if (schedules.length === 0) {
            listContainer.innerHTML = '<div class="empty-state">No active schedules found.</div>';
            return;
        }
        
        schedules.sort((a, b) => b.isActive - a.isActive || new Date(b.createdAt) - new Date(a.createdAt));
        
        schedules.forEach(sch => {
            const clone = template.content.cloneNode(true);
            const card = clone.querySelector('.schedule-card');
            if(!sch.isActive) card.style.opacity = '0.6';

            clone.querySelector('.sch-title').textContent = sch.name || 'Untitled';
            clone.querySelector('.sch-url').textContent = sch.webhookUrl;
            clone.querySelector('.sch-type-badge').textContent = getScheduleDescription(sch);
            
            const toggle = clone.querySelector('.sch-active-toggle');
            toggle.checked = sch.isActive;
            toggle.addEventListener('change', async (e) => {
                await fetch(`/api/schedules/${sch.id}/toggle`, {
                    method: 'PUT',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({isActive: e.target.checked})
                });
                fetchSchedules();
            });

            clone.querySelector('.edit-btn').addEventListener('click', () => loadEditForm(sch));
            
            clone.querySelector('.delete-btn').addEventListener('click', async () => {
                if(confirm('Delete schedule?')) {
                    await fetch(`/api/schedules/${sch.id}`, { method: 'DELETE' });
                    fetchSchedules();
                }
            });
            
            listContainer.appendChild(clone);
        });
    }

    // Edit Logic
    function loadEditForm(sch) {
        isEditing = true;
        document.getElementById('form-title').textContent = 'Edit Schedule';
        document.getElementById('submit-btn-text').textContent = 'Update Schedule';
        document.getElementById('cancel-edit-btn').classList.remove('hidden');
        window.scrollTo({ top: 0, behavior: 'smooth' });

        document.getElementById('edit-id').value = sch.id;
        document.getElementById('schedule-name').value = sch.name;
        document.getElementById('webhook-url').value = sch.webhookUrl;
        
        typeSelect.value = sch.type;
        typeSelect.dispatchEvent(new Event('change'));

        if (sch.type === 'once') document.getElementById('param-once-time').value = sch.params.targetTime;
        if (sch.type === 'minutes') document.getElementById('param-minutes-val').value = sch.params.value;
        if (sch.type === 'hours') document.getElementById('param-hours-val').value = sch.params.value;
        if (sch.type === 'daily') document.getElementById('param-daily-time').value = sch.params.time;
        if (sch.type === 'weekly') {
            document.getElementById('param-weekly-day').value = sch.params.weekday;
            document.getElementById('param-weekly-time').value = sch.params.time;
        }
    }

    document.getElementById('cancel-edit-btn').addEventListener('click', resetForm);

    function resetForm() {
        form.reset();
        isEditing = false;
        document.getElementById('edit-id').value = '';
        document.getElementById('form-title').textContent = 'Add New Schedule';
        document.getElementById('submit-btn-text').textContent = 'Save Schedule';
        document.getElementById('cancel-edit-btn').classList.add('hidden');
        typeSelect.dispatchEvent(new Event('change'));
    }

    // Logs List
    async function fetchLogs() {
        try {
            const res = await fetch('/api/logs');
            const data = await res.json();
            renderLogs(data);
        } catch (err) {
            logsContainer.innerHTML = '<div class="empty-state">Failed to fetch logs</div>';
        }
    }

    function renderLogs(logs) {
        logsContainer.innerHTML = '';
        if (logs.length === 0) {
            logsContainer.innerHTML = '<div class="empty-state">No execution logs yet.</div>';
            return;
        }
        
        logs.forEach(log => {
            const clone = logTemplate.content.cloneNode(true);
            const date = new Date(log.time); 
            
            clone.querySelector('.log-time').textContent = date.toLocaleString('en-US', {month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second:'2-digit'});
            clone.querySelector('.log-name').textContent = log.scheduleName || 'Unknown';
            clone.querySelector('.log-url').textContent = log.webhookUrl;
            
            const statusBadge = clone.querySelector('.log-status');
            statusBadge.textContent = log.status;
            statusBadge.classList.add(log.status);

            if(log.response) {
                statusBadge.title = log.response;
                statusBadge.style.cursor = 'help';
            }

            logsContainer.appendChild(clone);
        });
    }

    document.getElementById('clear-logs-btn').addEventListener('click', async () => {
        if(confirm('Clear all logs?')) {
            await fetch('/api/logs', { method: 'DELETE' });
            fetchLogs();
        }
    });

    // UI Utilities
    function setLoading(loading) {
        const btn = document.getElementById('submit-btn');
        const spinner = btn.querySelector('.spinner');
        if (loading) {
            btn.disabled = true; spinner.classList.remove('hidden');
        } else {
            btn.disabled = false; spinner.classList.add('hidden');
        }
    }

    function showMessage(text, type) {
        messageEl.textContent = text;
        messageEl.className = `message ${type}`;
        setTimeout(() => messageEl.classList.add('hidden'), 4000);
    }

    init();
});
