import React from "react";
import { AnimatePresence, LayoutGroup, motion, type Variants } from "framer-motion";
import { CheckCircle2, Circle, CircleAlert, CircleDotDashed, CircleX } from "lucide-react";

const cn = (...classes: Array<string | undefined | null | false>) => classes.filter(Boolean).join(" ");

export type PlanStatus = "completed" | "in-progress" | "pending" | "need-help" | "failed";

export type PlanSubtask = {
  id: string;
  title: string;
  description: string;
  status: PlanStatus;
  priority: "high" | "medium" | "low";
  tools?: string[];
  command?: string;
  stdout?: string;
  stderr?: string;
  durationMs?: number;
};

export type PlanTask = {
  id: string;
  title: string;
  description: string;
  status: PlanStatus;
  priority: "high" | "medium" | "low";
  level: number;
  dependencies: string[];
  subtasks: PlanSubtask[];
};

export type AgentPlanProps = {
  tasks: PlanTask[];
  activeSubtaskId?: string | null;
  className?: string;
};

export function AgentPlan({ tasks, activeSubtaskId, className }: AgentPlanProps) {
  const [expandedTasks, setExpandedTasks] = React.useState<string[]>([]);
  const [expandedSubtasks, setExpandedSubtasks] = React.useState<Record<string, boolean>>({});
  const [prefersReducedMotion, setPrefersReducedMotion] = React.useState(false);
  const subtaskRefs = React.useRef<Record<string, HTMLLIElement | null>>({});

  React.useEffect(() => {
    setPrefersReducedMotion(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  React.useEffect(() => {
    if (!activeSubtaskId) return;
    const activeTask = tasks.find((task) => task.subtasks.some((subtask) => subtask.id === activeSubtaskId));
    if (!activeTask) return;
    setExpandedTasks([activeTask.id]);
    setExpandedSubtasks({ [activeSubtaskId]: true });
    window.setTimeout(() => {
      subtaskRefs.current[activeSubtaskId]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }, 80);
  }, [activeSubtaskId, tasks]);

  const toggleTaskExpansion = (taskId: string) => {
    setExpandedTasks((previous) =>
      previous.includes(taskId) ? previous.filter((id) => id !== taskId) : [...previous, taskId]
    );
  };

  const toggleSubtaskExpansion = (subtaskId: string) => {
    setExpandedSubtasks((previous) => ({ ...previous, [subtaskId]: !previous[subtaskId] }));
  };

  const taskVariants: Variants = {
    hidden: { opacity: 0, y: prefersReducedMotion ? 0 : -5 },
    visible: {
      opacity: 1,
      y: 0,
      transition: {
        type: prefersReducedMotion ? ("tween" as const) : ("spring" as const),
        stiffness: 500,
        damping: 30,
        duration: prefersReducedMotion ? 0.2 : undefined
      }
    }
  };

  const subtaskListVariants: Variants = {
    hidden: { opacity: 0, height: 0, overflow: "hidden" },
    visible: {
      height: "auto",
      opacity: 1,
      overflow: "visible",
      transition: {
        duration: 0.25,
        staggerChildren: prefersReducedMotion ? 0 : 0.04,
        when: "beforeChildren",
        ease: "easeOut"
      }
    }
  };

  const subtaskVariants: Variants = {
    hidden: { opacity: 0, x: prefersReducedMotion ? 0 : -10 },
    visible: {
      opacity: 1,
      x: 0,
      transition: {
        type: prefersReducedMotion ? ("tween" as const) : ("spring" as const),
        stiffness: 500,
        damping: 25,
        duration: prefersReducedMotion ? 0.2 : undefined
      }
    }
  };

  return (
    <div className={cn("h-full overflow-visible p-2 text-white", className)}>
      <motion.div
        className="overflow-hidden rounded-[8px] border border-white/10 bg-[#111214]/90 shadow-2xl backdrop-blur"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0, transition: { duration: 0.3, ease: [0.2, 0.65, 0.3, 0.9] } }}
      >
        <LayoutGroup>
          <div className="p-4">
            <ul className="space-y-1">
              {tasks.map((task, index) => {
                const isExpanded = expandedTasks.includes(task.id);
                const isCompleted = task.status === "completed";

                return (
                  <motion.li
                    key={task.id}
                    className={cn(index !== 0 && "mt-1 pt-2")}
                    initial="hidden"
                    animate="visible"
                    variants={taskVariants}
                  >
                    <motion.div className="group flex items-center rounded-md px-3 py-1.5" whileHover={{ backgroundColor: "rgba(255,255,255,0.04)" }}>
                      <div className="mr-2 flex-shrink-0">
                        <StatusIcon status={task.status} />
                      </div>

                      <button
                        type="button"
                        className="flex min-w-0 flex-grow cursor-pointer items-center justify-between text-left"
                        onClick={() => toggleTaskExpansion(task.id)}
                      >
                        <div className="mr-2 flex-1 truncate">
                          <span className={cn(isCompleted && "text-white/40 line-through")}>{task.title}</span>
                        </div>

                        <div className="flex flex-shrink-0 items-center gap-2 text-xs">
                          {task.dependencies.map((dependency) => (
                            <span key={dependency} className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-medium text-white/65">
                              {dependency}
                            </span>
                          ))}
                          <StatusBadge status={task.status} />
                        </div>
                      </button>
                    </motion.div>

                    <AnimatePresence mode="wait">
                      {isExpanded && task.subtasks.length > 0 && (
                        <motion.div
                          className="relative overflow-hidden"
                          variants={subtaskListVariants}
                          initial="hidden"
                          animate="visible"
                          exit="hidden"
                          layout
                        >
                          <div className="absolute bottom-0 left-[20px] top-0 border-l-2 border-dashed border-white/15" />
                          <ul className="mb-1.5 ml-3 mr-2 mt-1 space-y-0.5">
                            {task.subtasks.map((subtask) => {
                              const isSubtaskExpanded = expandedSubtasks[subtask.id];
                              const isSubtaskCompleted = subtask.status === "completed";

                              return (
                                <motion.li
                                  key={subtask.id}
                                  ref={(node) => {
                                    subtaskRefs.current[subtask.id] = node;
                                  }}
                                  className="group flex flex-col py-0.5 pl-6"
                                  variants={subtaskVariants}
                                  initial="hidden"
                                  animate="visible"
                                  exit="hidden"
                                  layout
                                >
                                  <motion.button
                                    type="button"
                                    className="flex flex-1 items-center rounded-md p-1 text-left"
                                    onClick={() => toggleSubtaskExpansion(subtask.id)}
                                    whileHover={{ backgroundColor: "rgba(255,255,255,0.04)" }}
                                    layout
                                  >
                                    <span className="mr-2 flex-shrink-0">
                                      <StatusIcon status={subtask.status} small />
                                    </span>
                                    <span className={cn("cursor-pointer text-sm", isSubtaskCompleted && "text-white/40 line-through")}>
                                      {subtask.title}
                                    </span>
                                  </motion.button>

                                  <AnimatePresence mode="wait">
                                    {isSubtaskExpanded && (
                                      <motion.div
                                        className="ml-1.5 mt-1 overflow-hidden border-l border-dashed border-white/20 pl-5 text-xs text-white/55"
                                        initial={{ opacity: 0, height: 0 }}
                                        animate={{ opacity: 1, height: "auto", transition: { duration: 0.25, ease: [0.2, 0.65, 0.3, 0.9] } }}
                                        exit={{ opacity: 0, height: 0 }}
                                        layout
                                      >
                                        <p className="py-1">{subtask.description}</p>
                                        <ToolChips tools={subtask.tools ?? []} />
                                        {(subtask.command || subtask.stdout || subtask.stderr) && (
                                          <TerminalBlock subtask={subtask} />
                                        )}
                                      </motion.div>
                                    )}
                                  </AnimatePresence>
                                </motion.li>
                              );
                            })}
                          </ul>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.li>
                );
              })}
            </ul>
          </div>
        </LayoutGroup>
      </motion.div>
    </div>
  );
}

function StatusIcon({ status, small = false }: { status: PlanStatus; small?: boolean }) {
  const className = small ? "h-3.5 w-3.5" : "h-[18px] w-[18px]";
  if (status === "completed") return <CheckCircle2 className={`${className} text-emerald-400`} />;
  if (status === "in-progress") return <CircleDotDashed className={`${className} text-sky-400`} />;
  if (status === "need-help") return <CircleAlert className={`${className} text-yellow-400`} />;
  if (status === "failed") return <CircleX className={`${className} text-red-400`} />;
  return <Circle className={`${className} text-white/35`} />;
}

function StatusBadge({ status }: { status: PlanStatus }) {
  const classes = {
    completed: "bg-emerald-500/15 text-emerald-200",
    "in-progress": "bg-sky-500/15 text-sky-200",
    "need-help": "bg-yellow-500/15 text-yellow-200",
    failed: "bg-red-500/15 text-red-200",
    pending: "bg-white/10 text-white/50"
  };
  return <span className={`rounded px-1.5 py-0.5 text-[10px] ${classes[status]}`}>{status}</span>;
}

function ToolChips({ tools }: { tools: string[] }) {
  if (tools.length === 0) return null;
  return (
    <div className="mb-1 mt-0.5 flex flex-wrap items-center gap-1.5">
      <span className="font-medium text-white/45">Tools:</span>
      {tools.map((tool) => (
        <span key={tool} className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-medium text-white/60">
          {tool}
        </span>
      ))}
    </div>
  );
}

function TerminalBlock({ subtask }: { subtask: PlanSubtask }) {
  return (
    <div className="my-2 overflow-hidden rounded-[8px] border border-white/10 bg-black/35">
      {subtask.command && (
        <pre className="overflow-auto whitespace-pre-wrap break-words border-b border-white/10 bg-black/45 p-2 text-[11px] leading-5 text-sky-100">
          {subtask.command}
        </pre>
      )}
      <pre className="max-h-36 overflow-auto whitespace-pre-wrap break-words p-2 text-[11px] leading-5 text-white/65">
        {subtask.stdout}
        {subtask.stderr ? `\n${subtask.stderr}` : ""}
      </pre>
      {typeof subtask.durationMs === "number" && (
        <div className="border-t border-white/10 px-2 py-1 text-[10px] text-white/35">{subtask.durationMs} ms</div>
      )}
    </div>
  );
}
