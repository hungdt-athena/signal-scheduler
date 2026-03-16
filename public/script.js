document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('schedule-form');
    const submitBtn = document.getElementById('submit-btn');
    const spinner = submitBtn.querySelector('.spinner');
    const messageEl = document.getElementById('form-message');
    const listContainer = document.getElementById('schedules-list');
    const template = document.getElementById('schedule-template');
    
    // Set min datetime for input to current time
    const timeInput = document.getElementById('target-time');
    const now = new Date();
    // Format to YYYY-MM-DDThh:mm for input attribute
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    timeInput.min = now.toISOString().slice(0, 16);
    
    // Load initial schedules
    fetchSchedules();
    
    // Auto-refresh schedules every minute to clean up past ones
    setInterval(fetchSchedules, 60000);

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const targetTime = document.getElementById('target-time').value;
        const webhookUrl = document.getElementById('webhook-url').value;
        
        const selectedDate = new Date(targetTime);
        if (selectedDate <= new Date()) {
            showMessage('Please select a future time', 'error');
            return;
        }

        setLoading(true);
        messageEl.classList.add('hidden');
        
        try {
            const res = await fetch('/api/schedules', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ targetTime, webhookUrl })
            });
            
            const data = await res.json();
            
            if (res.ok) {
                showMessage('Schedule added successfully!', 'success');
                form.reset();
                timeInput.min = new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
                fetchSchedules(); // Refresh list
            } else {
                showMessage(data.error || 'Failed to add schedule', 'error');
            }
        } catch (err) {
            showMessage('Network error occurred', 'error');
            console.error(err);
        } finally {
            setLoading(false);
        }
    });

    async function fetchSchedules() {
        try {
            const res = await fetch('/api/schedules');
            if (!res.ok) throw new Error('Failed to fetchs');
            const data = await res.json();
            renderSchedules(data);
        } catch (err) {
            listContainer.innerHTML = '<div class="error-state">Failed to load schedules. Is the server running?</div>';
        }
    }

    function renderSchedules(schedules) {
        listContainer.innerHTML = '';
        
        if (!schedules || schedules.length === 0) {
            listContainer.innerHTML = '<div class="empty-state">No active schedules found. Create one above!</div>';
            return;
        }
        
        // Sort by time ascending
        schedules.sort((a, b) => new Date(a.targetTime) - new Date(b.targetTime));
        
        schedules.forEach(schedule => {
            const dateObj = new Date(schedule.targetTime);
            
            // Format options
            const dateStr = dateObj.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
            const timeStr = dateObj.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
            
            const clone = template.content.cloneNode(true);
            const card = clone.querySelector('.schedule-card');
            clone.querySelector('.date').textContent = dateStr;
            clone.querySelector('.time').textContent = timeStr;
            clone.querySelector('.url-text').textContent = schedule.webhookUrl;
            
            const deleteBtn = clone.querySelector('.delete-btn');
            deleteBtn.addEventListener('click', () => deleteSchedule(schedule.id, card));
            
            listContainer.appendChild(clone);
        });
    }

    async function deleteSchedule(id, cardElement) {
        if (!confirm('Cancel this schedule?')) return;
        
        try {
            const res = await fetch(`/api/schedules/${id}`, { method: 'DELETE' });
            if (res.ok) {
                cardElement.style.opacity = '0';
                cardElement.style.transform = 'scale(0.9)';
                setTimeout(() => {
                    fetchSchedules();
                }, 300);
            } else {
                alert('Failed to delete schedule');
            }
        } catch (err) {
            alert('Error deleting schedule');
        }
    }

    function setLoading(isLoading) {
        if (isLoading) {
            submitBtn.classList.add('loading');
            spinner.classList.remove('hidden');
            submitBtn.disabled = true;
        } else {
            submitBtn.classList.remove('loading');
            spinner.classList.add('hidden');
            submitBtn.disabled = false;
        }
    }

    function showMessage(text, type) {
        messageEl.textContent = text;
        messageEl.className = `message ${type}`;
        
        // Auto hide after 5 seconds
        setTimeout(() => {
            messageEl.classList.add('hidden');
        }, 5000);
    }
});
