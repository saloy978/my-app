export default function EditForm({ front, back, onFrontChange, onBackChange, onCancel, onSave }) {
  return (
    <div className="mt-6 w-full max-w-md bg-white p-4 rounded-xl shadow">
      <h2 className="font-semibold mb-3">Редактирование карточки</h2>
      <div className="flex flex-col gap-2">
        <input
          value={front}
          onChange={(e) => onFrontChange(e.target.value)}
          className="px-3 py-2 border rounded"
          placeholder="Слово"
        />
        <input
          value={back}
          onChange={(e) => onBackChange(e.target.value)}
          className="px-3 py-2 border rounded"
          placeholder="Перевод"
        />
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel} className="px-4 py-2 rounded border">
            Отмена
          </button>
          <button
            onClick={onSave}
            className="px-4 py-2 rounded bg-blue-600 text-white"
          >
            💾 Сохранить
          </button>
        </div>
      </div>
    </div>
  );
}
