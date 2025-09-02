import { Edit, Plus, Trash2 } from "lucide-react";

export default function CardActions({ onEdit, onAdd, onDelete, disableEditDelete = false }) {
  return (
    <div className="flex gap-4 mt-4 text-gray-500">
      <button
        type="button"
        onClick={onEdit}
        title="Редактировать"
        disabled={disableEditDelete}
        className="disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <Edit size={24} />
      </button>
      <button type="button" onClick={onAdd} title="Добавить">
        <Plus size={24} />
      </button>
      <button
        type="button"
        onClick={onDelete}
        title="Удалить"
        disabled={disableEditDelete}
        className="disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <Trash2 size={24} />
      </button>
    </div>
  );
}
