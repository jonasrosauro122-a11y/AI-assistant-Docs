export async function writeActivity(supabase, entry) {
  if (!supabase || !entry?.action) return;

  const row = {
    actor_id: entry.actor?.id || null,
    actor_name: entry.actor?.full_name || entry.actor?.email || 'Unknown User',
    app: 'ai-docs',
    action: entry.action,
    target_type: entry.targetType || null,
    target_id: entry.targetId || null,
    metadata: entry.metadata || {}
  };

  const { error } = await supabase.from('activity_log').insert(row);
  if (error) console.warn('Activity log write failed:', error.message);
}
