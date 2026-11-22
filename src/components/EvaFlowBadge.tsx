export function EvaFlowBadge({ light = false }: { light?: boolean }) {
  return (
    <a
      href="https://evaflow.com.br"
      target="_blank"
      rel="noopener noreferrer"
      title="Tecnologia EvaFlow"
      className={`fixed right-3 bottom-[76px] md:bottom-3 z-30 flex items-center gap-1.5 rounded-full px-3 py-1.5 backdrop-blur-md transition-all hover:scale-105 ${
        light
          ? 'bg-white/90 border border-white/40 shadow-md'
          : 'bg-white/85 border border-[#e5e9f0] shadow-sm hover:shadow-md'
      }`}
    >
      <span className="text-[10px] font-medium tracking-wide text-[#5a6577]">by</span>
      <img
        src="/assets/EvaFlow-logotipo.svg"
        alt="EvaFlow"
        className="h-3.5 w-auto opacity-85 hover:opacity-100 transition-opacity"
      />
    </a>
  );
}
