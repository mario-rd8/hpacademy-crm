import { FileText, Kanban, LogOut, MessageCircle, Plus, Settings } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import type { AppTab } from '../types/database.types';

interface HeaderProps {
  activeTab: AppTab;
  unreadCount: number;
  onChangeTab: (tab: AppTab) => void;
  onOpenNewLead: () => void;
}

export function Header({ activeTab, unreadCount, onChangeTab, onOpenNewLead }: HeaderProps) {
  const { displayName, signOut } = useAuth();

  const navItems: { id: AppTab; label: string; icon: typeof Kanban; badge?: number }[] = [
    { id: 'kanban', label: 'Kanban', icon: Kanban },
    { id: 'chat', label: 'Conversas', icon: MessageCircle, badge: unreadCount },
    { id: 'materials', label: 'Materiais', icon: FileText },
    { id: 'settings', label: 'Configurações', icon: Settings },
  ];

  return (
    <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-[#e5e9f0]">
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
        {/* Marca */}
        <div className="flex items-center gap-3 min-w-0">
          <img
            src="/assets/HPAcademy_horizontal.svg"
            alt="HP Academy"
            className="h-7 sm:h-8 w-auto shrink-0"
          />
          <span className="hidden sm:inline-flex items-center rounded-md bg-[#012d63]/8 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-[#012d63]">
            CRM
          </span>
        </div>

        {/* Navegação Desktop */}
        <nav className="hidden md:flex items-center gap-1 bg-[#f6f7f9] p-1 rounded-xl border border-[#e5e9f0]">
          {navItems.map(({ id, label, icon: Icon, badge }) => {
            const active = activeTab === id;
            return (
              <button
                key={id}
                onClick={() => onChangeTab(id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all cursor-pointer ${
                  active
                    ? 'bg-[#012d63] text-white shadow-sm'
                    : 'text-[#5a6577] hover:text-[#012d63] hover:bg-white'
                }`}
              >
                <Icon className="h-4 w-4" />
                {label}
                {badge && badge > 0 ? (
                  <span
                    className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold leading-none ${
                      active ? 'bg-[#eb5b29] text-white' : 'bg-[#eb5b29] text-white'
                    }`}
                  >
                    {badge > 99 ? '99+' : badge}
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>

        {/* Ações direita */}
        <div className="flex items-center gap-2 sm:gap-3">
          <button
            onClick={onOpenNewLead}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#eb5b29] hover:bg-[#d44d1f] active:scale-[0.98] text-white text-xs sm:text-sm font-semibold px-3 sm:px-4 py-2.5 shadow-sm shadow-[#eb5b29]/25 transition-all cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            <span className="hidden xs:inline sm:inline">Novo Lead</span>
          </button>

          <div className="flex items-center gap-2 pl-2 border-l border-[#e5e9f0]">
            <div className="hidden sm:flex flex-col items-end leading-tight">
              <span className="text-xs font-semibold text-[#0f1f38]">{displayName}</span>
              <span className="text-[10px] text-[#8a94a6]">Online</span>
            </div>
            <button
              onClick={signOut}
              title="Sair"
              className="p-2 rounded-xl text-[#5a6577] hover:text-red-600 hover:bg-red-50 transition-colors cursor-pointer"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
