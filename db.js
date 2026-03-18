const { createClient } = require('@supabase/supabase-js');
const { v4: uuidv4 } = require('uuid');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// ── Schedules ──────────────────────────────────────────────────────────────

async function getSchedules() {
  const { data, error } = await supabase
    .from('schedules')
    .select('*, groups(name)')
    .order('created_at', { ascending: false });

  if (error) { console.error('getSchedules error:', error); return []; }

  return data.map(s => ({ ...s, group_name: s.groups?.name || 'General' }));
}

async function getScheduleById(id) {
  const { data, error } = await supabase
    .from('schedules')
    .select('*, groups(name)')
    .eq('id', id)
    .single();

  if (error) return null;
  return { ...data, group_name: data.groups?.name || 'General' };
}

async function createSchedule(schedule) {
  const { data, error } = await supabase
    .from('schedules')
    .insert([schedule])
    .select('*, groups(name)')
    .single();

  if (error) throw error;
  return { ...data, group_name: data.groups?.name || 'General' };
}

async function updateSchedule(id, updates) {
  const { data, error } = await supabase
    .from('schedules')
    .update(updates)
    .eq('id', id)
    .select('*, groups(name)')
    .single();

  if (error) { console.error('updateSchedule error:', error); return null; }
  return { ...data, group_name: data.groups?.name || 'General' };
}

async function deleteSchedule(id) {
  const { error } = await supabase.from('schedules').delete().eq('id', id);
  if (error) throw error;
}

// ── Groups ─────────────────────────────────────────────────────────────────

async function getGroups() {
  const { data, error } = await supabase
    .from('groups')
    .select('*')
    .order('name');

  if (error) { console.error('getGroups error:', error); return []; }
  return data;
}

async function findOrCreateGroup(name) {
  const trimmed = (name || 'General').trim();

  const { data: existing } = await supabase
    .from('groups')
    .select('id')
    .eq('name', trimmed)
    .single();

  if (existing) return existing.id;

  const newId = uuidv4();
  await supabase.from('groups').insert([{ id: newId, name: trimmed }]);
  return newId;
}

// ── Logs ───────────────────────────────────────────────────────────────────

async function getLogs(groupName) {
  let query = supabase
    .from('logs')
    .select('*')
    .order('time', { ascending: false })
    .limit(50);

  if (groupName) query = query.eq('group_name', groupName);

  const { data, error } = await query;
  if (error) { console.error('getLogs error:', error); return []; }
  return data;
}

async function addLog(log) {
  const { error } = await supabase.from('logs').insert([log]);
  if (error) console.error('addLog error:', error);
}

async function clearLogs() {
  const { error } = await supabase.from('logs').delete().neq('id', '');
  if (error) console.error('clearLogs error:', error);
}

module.exports = {
  getSchedules, getScheduleById, createSchedule, updateSchedule, deleteSchedule,
  getGroups, findOrCreateGroup,
  getLogs, addLog, clearLogs
};
