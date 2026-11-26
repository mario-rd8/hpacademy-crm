import { FileText, Kanban, MessageCircle, Settings } from 'lucide-react';
import type { AppTab } from '../types/database.types';

interface BottomNavProps {
  activeTab: AppTab;
  unreadCount: number;
  onChangeTab: (tab: AppTab) => void;
}

export function BottomNav({ activeTab, unreadCount, onChangeTab }: BottomNavProps) {
  const items: { id: AppTab; label: string; icon: typeof Kanban; badge?: number }[] = [
    { id: 'kanban', label: 'Kanban', icon: Kanban },
    { id: 'chat', label: 'Conversas', icon: MessageCircle, badge: unreadCount },
    { id: 'materials', label: 'Materiais', icon: FileText },
    { id: 'settings', label: 'Ajustes', icon: Settings },
  ];

  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur-md border-t border-[#e5e9f0] safe-pb">
      <div className="grid grid-cols-4 h-16">
        {items.map(({ id, label, icon: Icon, badge }) => {
          const active = activeTab === id;
          return (
            <button
              key={id}
              onClick={() => onChangeTab(id)}
              className={`flex flex-col items-center justify-center gap-1 transition-colors cursor-pointer ${active ? 'text-[#012d63]' : 'text-[#8a94a6]'
                }`}
            >
              <div
                className={`relative px-3.5 py-1 rounded-full transition-colors ${active ? 'bg-[#012d63]/10 text-[#012d63]' : ''
                  }`}
              >
                <Icon className="h-5 w-5" />
                {badge && badge > 0 ? (
                  <span className="absolute -top-0.5 right-0.5 h-4 min-w-4 px-1 rounded-full bg-[#eb5b29] text-white text-[9px] font-bold flex items-center justify-center">
                    {badge > 99 ? '99+' : badge}
                  </span>
                ) : null}
              </div>
              <span className={`text-[11px] ${active ? 'font-bold' : 'font-medium'}`}>
                {label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
