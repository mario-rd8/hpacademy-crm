import { useCallback, useEffect, useState } from 'react';
import { crmDb, supabase } from '../services/supabaseClient';
import type {
  EnrollmentStatus,
  Lead,
  LossReason,
  MediaTemplate,
  Stage,
  Tag,
  Task,
} from '../types/database.types';
import { normalizePhoneToDb, slugify } from '../utils/phone';

interface RawLeadRow {
  id: string;
  name: string;
  phone: string;
  stage_id: string;
  source: string;
  loss_reason: string | null;
  enrollment_status: EnrollmentStatus;
  has_whatsapp: boolean;
  is_returning: boolean;
  unread_count?: number;
  last_message_preview?: string | null;
  last_message_at?: string | null;
  avatar_url?: string | null;
  last_activity_at: string;
  created_at: string;
  updated_at: string;
  lead_tags?: { tag_id: string; tags: Tag | null }[];
  tasks?: Task[];
}

export function useCrmData(enabled: boolean) {
  const [stages, setStages] = useState<Stage[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [templates, setTemplates] = useState<MediaTemplate[]>([]);
  const [lossReasons, setLossReasons] = useState<LossReason[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    if (!enabled) return;
    setError(null);

    try {
      const [stagesRes, tagsRes, leadsRes, templatesRes, reasonsRes] = await Promise.all([
        crmDb().from('stages').select('*').order('position', { ascending: true }),
        crmDb().from('tags').select('*').order('name', { ascending: true }),
        crmDb()
          .from('leads')
          .select('*, lead_tags(tag_id, tags(*)), tasks(*)')
          .order('last_activity_at', { ascending: false }),
        crmDb().from('media_templates').select('*').order('created_at', { ascending: false }),
        crmDb().from('loss_reasons').select('*').order('position', { ascending: true }),
      ]);

      const firstError =
        stagesRes.error || tagsRes.error || leadsRes.error || templatesRes.error || reasonsRes.error;
      if (firstError) {
        throw new Error(firstError.message);
      }

      setStages((stagesRes.data ?? []) as Stage[]);
      setTags((tagsRes.data ?? []) as Tag[]);
      setTemplates((templatesRes.data ?? []) as MediaTemplate[]);
      setLossReasons((reasonsRes.data ?? []) as LossReason[]);

      const formattedLeads: Lead[] = ((leadsRes.data ?? []) as unknown as RawLeadRow[]).map((row) => ({
        id: row.id,
        name: row.name,
        phone: row.phone,
        stage_id: row.stage_id,
        source: row.source,
        loss_reason: row.loss_reason,
        enrollment_status: row.enrollment_status,
        has_whatsapp: row.has_whatsapp,
        is_returning: row.is_returning,
        unread_count: row.unread_count ?? 0,
        last_message_preview: row.last_message_preview ?? null,
        last_message_at: row.last_message_at ?? null,
        avatar_url: row.avatar_url ?? null,
        last_activity_at: row.last_activity_at,
        created_at: row.created_at,
        updated_at: row.updated_at,
        tags: (row.lead_tags ?? [])
          .map((lt) => lt.tags)
          .filter((t): t is Tag => Boolean(t)),
        tasks: (row.tasks ?? []).sort(
          (a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime()
        ),
      }));

      setLeads(formattedLeads);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar dados do CRM.');
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    setLoading(true);
    fetchAll();
  }, [enabled, fetchAll]);

  // Supabase Realtime para leads, tarefas, tags e etapas
  useEffect(() => {
    if (!enabled) return;

    const channel = supabase
      .channel('crm-realtime-board')
      .on('postgres_changes', { event: '*', schema: 'crm', table: 'leads' }, () => {
        fetchAll();
      })
      .on('postgres_changes', { event: '*', schema: 'crm', table: 'lead_tags' }, () => {
        fetchAll();
      })
      .on('postgres_changes', { event: '*', schema: 'crm', table: 'tasks' }, () => {
        fetchAll();
      })
      .on('postgres_changes', { event: '*', schema: 'crm', table: 'stages' }, () => {
        fetchAll();
      })
      .on('postgres_changes', { event: '*', schema: 'crm', table: 'tags' }, () => {
        fetchAll();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [enabled, fetchAll]);

  // Mutações de Leads
  async function createLead(input: {
    name: string;
    phone: string;
    stageId: string;
    tagIds: string[];
    hasWhatsapp: boolean;
    source?: string;
  }) {
    const cleanPhone = normalizePhoneToDb(input.phone);

    // Verifica se já existe lead com o mesmo telefone (evita duplicidade e sinaliza retorno)
    const { data: existing } = await crmDb()
      .from('leads')
      .select('id')
      .eq('phone', cleanPhone)
      .maybeSingle();

    if (existing) {
      await crmDb()
        .from('leads')
        .update({
          is_returning: true,
          last_activity_at: new Date().toISOString(),
        })
        .eq('id', existing.id);

      if (input.tagIds.length > 0) {
        await crmDb()
          .from('lead_tags')
          .upsert(
            input.tagIds.map((tagId) => ({ lead_id: existing.id, tag_id: tagId })),
            { onConflict: 'lead_id,tag_id' }
          );
      }

      await fetchAll();
      return { id: existing.id, existed: true };
    }

    const { data: created, error: insertError } = await crmDb()
      .from('leads')
      .insert({
        name: input.name.trim(),
        phone: cleanPhone,
        stage_id: input.stageId,
        has_whatsapp: input.hasWhatsapp,
        source: input.source || 'manual',
        last_activity_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (insertError || !created) {
      throw new Error(insertError?.message || 'Erro ao criar lead.');
    }

    if (input.tagIds.length > 0) {
      await crmDb()
        .from('lead_tags')
        .insert(input.tagIds.map((tagId) => ({ lead_id: created.id, tag_id: tagId })));
    }

    await fetchAll();
    return { id: created.id as string, existed: false };
  }

  async function moveLeadStage(leadId: string, stageId: string, lossReason?: string | null) {
    const payload: Record<string, unknown> = {
      stage_id: stageId,
      last_activity_at: new Date().toISOString(),
    };
    if (lossReason !== undefined) {
      payload.loss_reason = lossReason;
    }

    // Atualização otimista
    setLeads((prev) =>
      prev.map((l) =>
        l.id === leadId
          ? {
              ...l,
              stage_id: stageId,
              loss_reason: lossReason !== undefined ? lossReason : l.loss_reason,
              last_activity_at: new Date().toISOString(),
            }
          : l
      )
    );

    const { error: updateError } = await crmDb().from('leads').update(payload).eq('id', leadId);
    if (updateError) {
      await fetchAll();
      throw new Error(updateError.message);
    }
  }

  async function updateLead(
    leadId: string,
    patch: Partial<{
      name: string;
      phone: string;
      stage_id: string;
      loss_reason: string | null;
      enrollment_status: EnrollmentStatus;
      has_whatsapp: boolean;
      is_returning: boolean;
    }>
  ) {
    const dbPatch: Record<string, unknown> = { ...patch, last_activity_at: new Date().toISOString() };
    if (patch.phone) {
      dbPatch.phone = normalizePhoneToDb(patch.phone);
    }

    const { error: updateError } = await crmDb().from('leads').update(dbPatch).eq('id', leadId);
    if (updateError) throw new Error(updateError.message);
    await fetchAll();
  }

  async function toggleLeadTag(leadId: string, tagId: string, hasTag: boolean) {
    if (hasTag) {
      const { error: delError } = await crmDb()
        .from('lead_tags')
        .delete()
        .eq('lead_id', leadId)
        .eq('tag_id', tagId);
      if (delError) throw new Error(delError.message);
    } else {
      const { error: insError } = await crmDb()
        .from('lead_tags')
        .upsert({ lead_id: leadId, tag_id: tagId }, { onConflict: 'lead_id,tag_id' });
      if (insError) throw new Error(insError.message);
    }
    await fetchAll();
  }

  async function deleteLead(leadId: string) {
    const { error: delError } = await crmDb().from('leads').delete().eq('id', leadId);
    if (delError) throw new Error(delError.message);
    await fetchAll();
  }

  // Mutações de Configurações (Stages, Tags, Loss Reasons)
  async function createStage(name: string, color: string) {
    const nextPos = stages.length > 0 ? Math.max(...stages.map((s) => s.position)) + 1 : 0;
    const baseSlug = slugify(name) || `etapa-${Date.now()}`;
    const { error: err } = await crmDb().from('stages').insert({
      name: name.trim(),
      slug: `${baseSlug}-${Math.random().toString(36).slice(2, 6)}`,
      position: nextPos,
      color,
      is_system: false,
    });
    if (err) throw new Error(err.message);
    await fetchAll();
  }

  async function updateStage(stageId: string, patch: Partial<Pick<Stage, 'name' | 'color' | 'position'>>) {
    const { error: err } = await crmDb().from('stages').update(patch).eq('id', stageId);
    if (err) throw new Error(err.message);
    await fetchAll();
  }

  async function reorderStages(orderedStages: Stage[]) {
    setStages(orderedStages);
    await Promise.all(
      orderedStages.map((s, idx) => crmDb().from('stages').update({ position: idx }).eq('id', s.id))
    );
    await fetchAll();
  }

  async function deleteStage(stageId: string) {
    const { error: err } = await crmDb().from('stages').delete().eq('id', stageId);
    if (err) throw new Error(err.message);
    await fetchAll();
  }

  async function createTag(name: string, color: string) {
    const { error: err } = await crmDb().from('tags').insert({ name: name.trim(), color });
    if (err) throw new Error(err.message);
    await fetchAll();
  }

  async function deleteTag(tagId: string) {
    const { error: err } = await crmDb().from('tags').delete().eq('id', tagId);
    if (err) throw new Error(err.message);
    await fetchAll();
  }

  async function createLossReason(label: string) {
    const nextPos = lossReasons.length > 0 ? Math.max(...lossReasons.map((r) => r.position)) + 1 : 0;
    const { error: err } = await crmDb().from('loss_reasons').insert({
      label: label.trim(),
      position: nextPos,
    });
    if (err) throw new Error(err.message);
    await fetchAll();
  }

  async function deleteLossReason(reasonId: string) {
    const { error: err } = await crmDb().from('loss_reasons').delete().eq('id', reasonId);
    if (err) throw new Error(err.message);
    await fetchAll();
  }

  return {
    stages,
    leads,
    tags,
    templates,
    lossReasons,
    loading,
    error,
    refresh: fetchAll,
    createLead,
    moveLeadStage,
    updateLead,
    toggleLeadTag,
    deleteLead,
    createStage,
    updateStage,
    reorderStages,
    deleteStage,
    createTag,
    deleteTag,
    createLossReason,
    deleteLossReason,
  };
}
