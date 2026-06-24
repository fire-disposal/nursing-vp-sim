const nodes = [
	{
		label: "训练引擎",
		detail: "守卫 / 提示 / LLM / 副作用",
		accent: "from-cyan-500 to-sky-500",
		style: "translate-x-[-12%] translate-y-[8%]",
	},
	{
		label: "虚拟患者",
		detail: "角色扮演 / 情绪 / 信息披露",
		accent: "from-violet-500 to-fuchsia-500",
		style: "translate-x-[14%] translate-y-[-10%]",
	},
	{
		label: "透明评分",
		detail: "SSE / 证据 / 可解释反馈",
		accent: "from-emerald-500 to-teal-500",
		style: "translate-y-[12%]",
	},
];

export default function SystemOrbit() {
	return (
		<div className="relative aspect-[4/3] overflow-hidden rounded-[2rem] border border-border/60 bg-card p-5 shadow-[0_24px_80px_-40px_rgba(15,23,42,0.55)]">
			<div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(13,148,136,0.12),transparent_22%),radial-gradient(circle_at_20%_20%,rgba(168,85,247,0.10),transparent_24%),radial-gradient(circle_at_80%_70%,rgba(59,130,246,0.10),transparent_26%)]" />
			<div className="absolute inset-0 opacity-50 [background-image:linear-gradient(rgba(148,163,184,0.10)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.10)_1px,transparent_1px)] [background-size:48px_48px]" />
			<div className="absolute left-1/2 top-1/2 h-56 w-56 -translate-x-1/2 -translate-y-1/2 rounded-full border border-border/40 bg-background/40 backdrop-blur-md" />
			<div className="absolute left-1/2 top-1/2 h-72 w-72 -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed border-primary/20" />

			<div className="relative z-10 flex h-full items-center justify-center">
				<div className="absolute h-56 w-56 rounded-full bg-primary/10 blur-3xl animate-pulse" />
				<div className="relative flex size-36 items-center justify-center rounded-full border border-primary/25 bg-background/80 shadow-2xl shadow-primary/10 backdrop-blur-xl">
					<div className="absolute inset-3 rounded-full border border-dashed border-primary/20" />
					<div className="text-center">
						<div className="text-[10px] font-semibold uppercase tracking-[0.35em] text-muted-foreground">Virtual Patient</div>
						<div className="mt-2 text-2xl font-black tracking-tight text-foreground">core</div>
					</div>
				</div>

				{nodes.map((node, index) => (
					<div
						key={node.label}
						className={`absolute left-1/2 top-1/2 ${node.style} -translate-x-1/2 -translate-y-1/2 transition-transform duration-500 hover:scale-105`}
					>
						<div className={`absolute inset-0 rounded-[1.75rem] bg-gradient-to-r ${node.accent} opacity-15 blur-xl`} />
						<div className="relative w-40 rounded-[1.75rem] border border-border/60 bg-background/75 p-4 shadow-xl backdrop-blur-md">
							<div className={`mb-3 h-1.5 rounded-full bg-gradient-to-r ${node.accent}`} />
							<div className="text-sm font-bold text-foreground">{node.label}</div>
							<div className="mt-1 text-xs leading-relaxed text-muted-foreground">{node.detail}</div>
							<div className="mt-4 flex items-center justify-between text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
								<span>0{index + 1}</span>
								<span>live</span>
							</div>
						</div>
					</div>
				))}
			</div>
		</div>
	);
}