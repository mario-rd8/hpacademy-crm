import { useState, type ChangeEvent, type FormEvent } from 'react';
import {
  Edit3,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Loader2,
  Plus,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { crmDb, supabase } from '../services/supabaseClient';
import type { MediaTemplate } from '../types/database.types';

interface MediaLibraryViewProps {
  templates: MediaTemplate[];
  onRefresh: () => Promise<void>;
}

export function MediaLibraryView({ templates, onRefresh }: MediaLibraryViewProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<MediaTemplate | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openNew() {
    setEditing(null);
    setTitle('');
    setBody('');
    setFile(null);
    setError(null);
    setModalOpen(true);
  }

  function openEdit(tpl: MediaTemplate) {
    setEditing(tpl);
    setTitle(tpl.title);
    setBody(tpl.body);
    setFile(null);
    setError(null);
    setModalOpen(true);
  }

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0] || null;
    if (!picked) return;
    const allowed = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'];
    if (!allowed.includes(picked.type)) {
      setError('Envie apenas arquivos PNG, JPG, WEBP ou PDF.');
      return;
    }
    setError(null);
    setFile(picked);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!title.trim()) {
      setError('Informe um título para o material.');
      return;
    }

    setSaving(true);
    try {
      let fileUrl = editing?.file_url ?? null;
      let fileName = editing?.file_name ?? null;
      let fileType = editing?.file_type ?? null;
      let storagePath = editing?.storage_path ?? null;

      if (file) {
        const ext = file.name.split('.').pop() || 'bin';
        const safePath = `templates/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from('crm-media')
          .upload(safePath, file, { upsert: false, contentType: file.type });

        if (uploadError) {
          throw new Error(`Erro no upload: ${uploadError.message}`);
        }

        const { data: pubData } = supabase.storage.from('crm-media').getPublicUrl(safePath);
        fileUrl = pubData.publicUrl;
        fileName = file.name;
        fileType = file.type;
        storagePath = safePath;
      }

      if (editing) {
        const { error: updErr } = await crmDb()
          .from('media_templates')
          .update({
            title: title.trim(),
            body: body.trim(),
            file_url: fileUrl,
            file_name: fileName,
            file_type: fileType,
            storage_path: storagePath,
          })
          .eq('id', editing.id);
        if (updErr) throw new Error(updErr.message);
      } else {
        const { error: insErr } = await crmDb().from('media_templates').insert({
          title: title.trim(),
          body: body.trim(),
          file_url: fileUrl,
          file_name: fileName,
          file_type: fileType,
          storage_path: storagePath,
        });
        if (insErr) throw new Error(insErr.message);
      }

      await onRefresh();
      setModalOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar material.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(tpl: MediaTemplate) {
    if (!window.confirm(`Excluir o material "${tpl.title}"?`)) return;
    if (tpl.storage_path) {
      await supabase.storage.from('crm-media').remove([tpl.storage_path]);
    }
    await crmDb().from('media_templates').delete().eq('id', tpl.id);
    await onRefresh();
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 pb-28 md:pb-10 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-[#012d63]">Biblioteca de Materiais</h1>
          <p className="text-xs sm:text-sm text-[#5a6577] mt-0.5">
            Anexos PNG/PDF e mensagens padrão com suporte à variável{' '}
            <code className="rounded bg-[#012d63]/8 px-1.5 py-0.5 font-mono text-xs text-[#012d63]">
              {'{{nome}}'}
            </code>
            .
          </p>
        </div>

        <button
          type="button"
          onClick={openNew}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#eb5b29] hover:bg-[#d44d1f] text-white font-semibold px-4 py-3 text-sm shadow-sm shadow-[#eb5b29]/25 cursor-pointer"
        >
          <Plus className="h-4 w-4" />
          Novo Material
        </button>
      </div>

      {templates.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-[#cbd5e1] bg-white p-12 text-center">
          <div className="mx-auto h-12 w-12 rounded-2xl bg-[#012d63]/8 text-[#012d63] flex items-center justify-center mb-3">
            <FileText className="h-6 w-6" />
          </div>
          <h2 className="text-base font-bold text-[#012d63]">Nenhum material cadastrado</h2>
          <p className="text-sm text-[#5a6577] mt-1 max-w-sm mx-auto">
            Suba tabelas de preços, grades de horários ou campanhas em PNG/PDF para disparar com 1 clique.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {templates.map((tpl) => (
            <div
              key={tpl.id}
              className="rounded-2xl bg-white border border-[#e5e9f0] overflow-hidden shadow-xs hover:shadow-md transition-all flex flex-col"
            >
              {/* Preview de mídia */}
              {tpl.file_url && tpl.file_type?.startsWith('image/') ? (
                <div className="h-40 bg-[#f6f7f9] border-b border-[#e5e9f0] flex items-center justify-center overflow-hidden">
                  <img
                    src={tpl.file_url}
                    alt={tpl.title}
                    className="h-full w-full object-cover"
                  />
                </div>
              ) : tpl.file_url ? (
                <div className="h-28 bg-[#012d63]/[0.04] border-b border-[#e5e9f0] flex flex-col items-center justify-center gap-1.5 px-4">
                  <FileText className="h-8 w-8 text-[#eb5b29]" />
                  <span className="text-xs font-semibold text-[#012d63] truncate max-w-full">
                    {tpl.file_name || 'Documento PDF'}
                  </span>
                </div>
              ) : null}

              <div className="p-4 flex-1 flex flex-col justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold text-[#012d63]">{tpl.title}</h3>
                  <p className="text-xs text-[#5a6577] whitespace-pre-wrap line-clamp-4 mt-1.5 leading-relaxed">
                    {tpl.body || <span className="italic text-[#8a94a6]">Sem legenda padrão</span>}
                  </p>
                </div>

                <div className="flex items-center justify-between pt-3 border-t border-[#f1f5f9]">
                  {tpl.file_url ? (
                    <a
                      href={tpl.file_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-semibold text-[#012d63] hover:text-[#eb5b29]"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Abrir anexo
                    </a>
                  ) : (
                    <span className="text-[11px] text-[#8a94a6]">Somente texto</span>
                  )}

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => openEdit(tpl)}
                      className="p-2 rounded-lg text-[#5a6577] hover:text-[#012d63] hover:bg-[#f6f7f9] cursor-pointer"
                    >
                      <Edit3 className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(tpl)}
                      className="p-2 rounded-lg text-[#5a6577] hover:text-red-600 hover:bg-red-50 cursor-pointer"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal Criar / Editar Material */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-[#012d63]/45 backdrop-blur-xs">
          <div className="w-full md:max-w-lg rounded-t-3xl md:rounded-3xl bg-white shadow-2xl border border-[#e5e9f0] animate-sheet-up max-h-[92dvh] flex flex-col">
            <div className="md:hidden flex justify-center pt-3 pb-1">
              <div className="h-1.5 w-12 rounded-full bg-[#cbd5e1]" />
            </div>

            <div className="flex items-center justify-between px-6 py-4 border-b border-[#e5e9f0]">
              <h2 className="text-base font-bold text-[#012d63]">
                {editing ? 'Editar Material' : 'Novo Material'}
              </h2>
              <button
                onClick={() => setModalOpen(false)}
                className="p-2 rounded-xl text-[#8a94a6] hover:text-[#012d63] cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-[#5a6577] mb-1.5">
                  Título
                </label>
                <input
                  type="text"
                  placeholder="Ex: Tabela de Preços ENEM 2026"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full rounded-xl border border-[#e5e9f0] bg-[#f6f7f9] px-3.5 py-3 text-sm font-medium focus:border-[#012d63] focus:bg-white focus:outline-none"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-[#5a6577]">
                    Legenda / Mensagem padrão
                  </label>
                  <button
                    type="button"
                    onClick={() => setBody((prev) => `${prev}${prev ? ' ' : ''}{{nome}}`)}
                    className="text-[11px] font-bold text-[#eb5b29] hover:underline cursor-pointer"
                  >
                    + Inserir {'{{nome}}'}
                  </button>
                </div>
                <textarea
                  rows={4}
                  placeholder="Olá {{nome}}! Segue nossa tabela de horários e condições especiais..."
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  className="w-full rounded-xl border border-[#e5e9f0] bg-[#f6f7f9] p-3 text-sm focus:border-[#012d63] focus:bg-white focus:outline-none resize-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-[#5a6577] mb-1.5">
                  Anexo (PNG ou PDF)
                </label>
                <label className="flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-[#cbd5e1] bg-[#f6f7f9] hover:border-[#012d63] p-5 text-center cursor-pointer transition-colors">
                  {file ? (
                    <div className="flex items-center gap-2 text-xs font-bold text-[#012d63]">
                      {file.type.startsWith('image/') ? (
                        <ImageIcon className="h-4 w-4 text-[#eb5b29]" />
                      ) : (
                        <FileText className="h-4 w-4 text-[#eb5b29]" />
                      )}
                      {file.name}
                    </div>
                  ) : (
                    <>
                      <Upload className="h-5 w-5 text-[#8a94a6]" />
                      <span className="text-xs font-medium text-[#5a6577]">
                        {editing?.file_name
                          ? `Atual: ${editing.file_name} (clique para substituir)`
                          : 'Toque para escolher PNG ou PDF (até 15MB)'}
                      </span>
                    </>
                  )}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,application/pdf"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                </label>
              </div>

              {error && (
                <div className="rounded-xl bg-red-50 border border-red-200 px-3.5 py-2.5 text-xs font-medium text-red-700">
                  {error}
                </div>
              )}

              <div className="flex items-center gap-3 pt-2 safe-pb">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="flex-1 rounded-xl border border-[#e5e9f0] py-3 text-sm font-semibold text-[#5a6577] cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-[#eb5b29] hover:bg-[#d44d1f] text-white py-3 text-sm font-semibold disabled:opacity-60 cursor-pointer"
                >
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                  Salvar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
