import { useMemo, useState } from 'react';
import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { useCrmData } from './hooks/useCrmData';
import type { AppTab, Lead } from './types/database.types';
import { BottomNav } from './components/BottomNav';
import { BulkSendModal } from './components/BulkSendModal';
import { ChatView } from './components/ChatView';
import { EvaFlowBadge } from './components/EvaFlowBadge';
import { Header } from './components/Header';
import { KanbanView } from './components/KanbanView';
import { LeadDrawer } from './components/LeadDrawer';
import { LoginScreen } from './components/LoginScreen';
import { LossReasonModal } from './components/LossReasonModal';
import { MediaLibraryView } from './components/MediaLibraryView';
import { NewLeadModal } from './components/NewLeadModal';
import { SettingsView } from './components/SettingsView';

function CrmWorkspace() {
  const { session, loading: authLoading } = useAuth();
  const crm = useCrmData(Boolean(session));

  const [activeTab, setActiveTab] = useState<AppTab>('kanban');
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [activeChatLeadId, setActiveChatLeadId] = useState<string | null>(null);
  const [selectedLeadIds, setSelectedLeadIds] = useState<string[]>([]);
  const [newLeadModalStageId, setNewLeadModalStageId] = useState<string | null | undefined>(undefined);
  const [bulkSendOpen, setBulkSendOpen] = useState(false);
  const [pendingLossMove, setPendingLossMove] = useState<{ lead: Lead; stageId: string } | null>(
    null
  );

  const totalUnreadCount = useMemo(
    () => crm.leads.reduce((sum, l) => sum + (l.unread_count || 0), 0),
    [crm.leads]
  );

  const activeLead = useMemo(
    () => crm.leads.find((l) => l.id === selectedLeadId) || null,
    [crm.leads, selectedLeadId]
  );

  const selectedLeads = useMemo(
    () => crm.leads.filter((l) => selectedLeadIds.includes(l.id)),
    [crm.leads, selectedLeadIds]
  );

  if (authLoading) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-[#012d63] text-white">
        <Loader2 className="h-7 w-7 animate-spin text-[#eb5b29]" />
      </div>
    );
  }

  if (!session) {
    return <LoginScreen />;
  }

  function handleRequestMove(lead: Lead, targetStageId: string) {
    const targetStage = crm.stages.find((s) => s.id === targetStageId);
    if (!targetStage) return;

    const isLost =
      targetStage.slug === 'perdido' || targetStage.name.toLowerCase() === 'perdido';
    if (isLost) {
      setPendingLossMove({ lead, stageId: targetStageId });
      return;
    }

    crm.moveLeadStage(lead.id, targetStageId, null);
  }

  function toggleSelectLead(leadId: string) {
    setSelectedLeadIds((prev) =>
      prev.includes(leadId) ? prev.filter((id) => id !== leadId) : [...prev, leadId]
    );
  }

  return (
    <div className="min-h-dvh flex flex-col bg-[#f6f7f9]">
      <Header
        activeTab={activeTab}
        unreadCount={totalUnreadCount}
        onChangeTab={setActiveTab}
        onOpenNewLead={() => setNewLeadModalStageId(crm.stages[0]?.id || null)}
      />

      <main className="flex-1 flex flex-col">
        {crm.loading ? (
          <div className="flex-1 flex items-center justify-center py-20">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="h-7 w-7 animate-spin text-[#012d63]" />
              <span className="text-xs font-semibold text-[#5a6577]">
                Sincronizando HP Academy CRM...
              </span>
            </div>
          </div>
        ) : crm.error ? (
          <div className="max-w-lg mx-auto my-12 px-4">
            <div className="rounded-2xl bg-white border border-red-200 p-6 text-center space-y-3 shadow-sm">
              <div className="mx-auto h-11 w-11 rounded-2xl bg-red-50 text-red-600 flex items-center justify-center">
                <AlertTriangle className="h-6 w-6" />
              </div>
              <h2 className="text-base font-bold text-[#012d63]">Erro ao conectar no schema crm</h2>
              <p className="text-xs text-[#5a6577] leading-relaxed">{crm.error}</p>
              <button
                type="button"
                onClick={crm.refresh}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#012d63] text-white px-4 py-2.5 text-xs font-bold cursor-pointer"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Tentar novamente
              </button>
            </div>
          </div>
        ) : activeTab === 'kanban' ? (
          <KanbanView
            stages={crm.stages}
            leads={crm.leads}
            tags={crm.tags}
            selectedLeadIds={selectedLeadIds}
            onToggleSelectLead={toggleSelectLead}
            onSelectMultipleLeads={setSelectedLeadIds}
            onClearSelection={() => setSelectedLeadIds([])}
            onOpenLead={(lead) => setSelectedLeadId(lead.id)}
            onRequestMove={handleRequestMove}
            onToggleEnrollment={(leadId, nextStatus) =>
              crm.updateLead(leadId, { enrollment_status: nextStatus })
            }
            onOpenBulkSend={() => setBulkSendOpen(true)}
            onOpenNewLead={(stageId) => setNewLeadModalStageId(stageId || crm.stages[0]?.id || null)}
          />
        ) : activeTab === 'chat' ? (
          <ChatView
            leads={crm.leads}
            stages={crm.stages}
            templates={crm.templates}
            selectedLeadId={activeChatLeadId}
            onSelectLead={setActiveChatLeadId}
            onOpenLeadDrawer={(lead) => setSelectedLeadId(lead.id)}
            onRequestMove={handleRequestMove}
          />
        ) : activeTab === 'materials' ? (
          <MediaLibraryView templates={crm.templates} onRefresh={crm.refresh} />
        ) : (
          <SettingsView
            stages={crm.stages}
            tags={crm.tags}
            lossReasons={crm.lossReasons}
            onCreateStage={crm.createStage}
            onUpdateStage={crm.updateStage}
            onReorderStages={crm.reorderStages}
            onDeleteStage={crm.deleteStage}
            onCreateTag={crm.createTag}
            onDeleteTag={crm.deleteTag}
            onCreateLossReason={crm.createLossReason}
            onDeleteLossReason={crm.deleteLossReason}
          />
        )}
      </main>

      <BottomNav
        activeTab={activeTab}
        unreadCount={totalUnreadCount}
        onChangeTab={setActiveTab}
      />
      {activeTab !== 'chat' && <EvaFlowBadge />}

      {/* Gaveta de detalhes do Lead */}
      {activeLead && (
        <LeadDrawer
          lead={activeLead}
          stages={crm.stages}
          tags={crm.tags}
          templates={crm.templates}
          onClose={() => setSelectedLeadId(null)}
          onOpenChat={(lead) => {
            setSelectedLeadId(null);
            setActiveChatLeadId(lead.id);
            setActiveTab('chat');
          }}
          onUpdateLead={crm.updateLead}
          onRequestMove={handleRequestMove}
          onToggleTag={crm.toggleLeadTag}
          onDeleteLead={crm.deleteLead}
          onRefreshBoard={crm.refresh}
        />
      )}

      {/* Modal Novo Lead */}
      {newLeadModalStageId !== undefined && (
        <NewLeadModal
          stages={crm.stages}
          tags={crm.tags}
          defaultStageId={newLeadModalStageId || undefined}
          onClose={() => setNewLeadModalStageId(undefined)}
          onCreate={crm.createLead}
        />
      )}

      {/* Modal Motivo de Perda */}
      {pendingLossMove && (
        <LossReasonModal
          lead={pendingLossMove.lead}
          reasons={crm.lossReasons}
          onCancel={() => setPendingLossMove(null)}
          onConfirm={async (reason) => {
            await crm.moveLeadStage(pendingLossMove.lead.id, pendingLossMove.stageId, reason);
            setPendingLossMove(null);
          }}
        />
      )}

      {/* Modal Disparo em Massa */}
      {bulkSendOpen && selectedLeads.length > 0 && (
        <BulkSendModal
          leads={selectedLeads}
          templates={crm.templates}
          onClose={() => setBulkSendOpen(false)}
          onSuccess={() => setSelectedLeadIds([])}
        />
      )}
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <CrmWorkspace />
    </AuthProvider>
  );
}
