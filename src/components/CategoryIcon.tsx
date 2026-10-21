import { Activity, HeartPulse, Smile, Stethoscope, Syringe, Baby, Brain, Pill, type LucideIcon } from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  stethoscope: Stethoscope, activity: Activity, "heart-pulse": HeartPulse, smile: Smile,
  syringe: Syringe, baby: Baby, brain: Brain, pill: Pill,
};
export const ICON_NAMES = Object.keys(ICONS);

export function CategoryIcon({ name, className = "h-6 w-6" }: { name: string; className?: string }) {
  const Icon = ICONS[name] ?? Stethoscope;
  return <Icon className={className} aria-hidden />;
}
