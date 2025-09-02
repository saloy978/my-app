import { Check, X } from "lucide-react";

export default function LearningControls({ onKnow, onDontKnow, disabled = false }) {
  return (
    <div className="flex gap-12 mt-6">
      {/* Не знаю */}
      <button
        type="button"
        onClick={onDontKnow}
        title="Не знаю"
        className="w-16 h-16 flex items-center justify-center rounded-full bg-red-500 text-white hover:bg-red-600 transition-colors shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
        disabled={disabled}
      >
        <X size={32} />
      </button>

      {/* Знаю */}
      <button
        type="button"
        onClick={onKnow}
        title="Знаю"
        className="w-16 h-16 flex items-center justify-center rounded-full bg-green-500 text-white hover:bg-green-600 transition-colors shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
        disabled={disabled}
      >
        <Check size={32} />
      </button>
    </div>
  );
}
