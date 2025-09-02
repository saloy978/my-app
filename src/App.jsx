import { useEffect, useRef, useState } from "react";
import EditForm from "./components/EditForm";
import AddForm from "./components/AddForm";
import LearningControls from "./components/LearningControls";
import CardActions from "./components/CardActions";
import { User } from "lucide-react";

export default function App() {
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [index, setIndex] = useState(0);
  const [showBack, setShowBack] = useState(false);
  const [progress, setProgress] = useState({}); // { [cardId]: { status: 'learn'|'know'|'learned', knowCount: number, nextDue: number } }
  // языки: L2 — язык слова/термина; L1 — язык перевода
  const [l1, setL1] = useState("ru");
  const [l2, setL2] = useState("en");
  const [langs, setLangs] = useState([]);
  const [langsLoading, setLangsLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  // режим показа: обычная карточка или ввод слова
  const [mode, setMode] = useState('card'); // 'card' | 'typing'
  const [answer, setAnswer] = useState("");
  const [checked, setChecked] = useState(null); // 'correct' | 'wrong' | null
  const [autoMode] = useState(true); // автопереключение по прогрессу всегда включен
  const [awaitingContinue, setAwaitingContinue] = useState(false); // legacy (не используется для ввода)
  const continueGuardRef = useRef(false); // legacy
  // таймер ближайшей карточки
  const [nextDueTs, setNextDueTs] = useState(0);
  const [countdown, setCountdown] = useState("\u2014");
  const reloadOnceRef = useRef(false);

  // авторизация
  const [token, setToken] = useState("");
  const [user, setUser] = useState(null);
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authMode, setAuthMode] = useState("login"); // login | register

  // редактирование
  const [isEditing, setIsEditing] = useState(false);
  const [editFront, setEditFront] = useState("");
  const [editBack, setEditBack] = useState("");

  // добавление
  const [isAdding, setIsAdding] = useState(false);
  const [addFront, setAddFront] = useState("");
  const [addBack, setAddBack] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/cards?l1=${encodeURIComponent(l1)}&l2=${encodeURIComponent(l2)}` , {
          headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) }
        });
        if (res.status === 401) {
          setCards([]);
          return;
        }
        if (!res.ok) throw new Error(`API ${res.status}`);
        const data = await res.json();
        setCards(data);
      } catch (e) {
        console.error(e);
        setError("Не удалось загрузить карточки.");
      } finally {
        setLoading(false);
      }
    })();
  }, [token, l1, l2]);

  // Инициализация токена/пользователя
  useEffect(() => {
    try {
      const t = localStorage.getItem("token");
      const u = localStorage.getItem("user");
      const savedL1 = localStorage.getItem("l1");
      const savedL2 = localStorage.getItem("l2");
      if (t) setToken(t);
      if (u) setUser(JSON.parse(u));
      if (savedL1) setL1(savedL1);
      if (savedL2) setL2(savedL2);
    } catch {}
  }, []);

  // Подтянуть предпочтения языков из профиля при наличии токена
  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const res = await fetch('/api/me', {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!res.ok) return;
        const me = await res.json();
        setUser(prev => ({ ...(prev || {}), ...me }));
        if (me.preferred_l1) { setL1(me.preferred_l1); localStorage.setItem('l1', me.preferred_l1); }
        if (me.preferred_l2) { setL2(me.preferred_l2); localStorage.setItem('l2', me.preferred_l2); }
      } catch {}
    })();
  }, [token]);

  // Сохранение выбора языков
  useEffect(() => {
    try {
      localStorage.setItem("l1", l1);
      localStorage.setItem("l2", l2);
    } catch {}
  }, [l1, l2]);

  // Загрузка языков из БД
  useEffect(() => {
    (async () => {
      try {
        setLangsLoading(true);
        const res = await fetch("/api/languages");
        if (!res.ok) throw new Error("langs");
        const data = await res.json();
        setLangs(data);
        if (data.length) {
          const codes = new Set(data.map(x => x.code));
          if (!codes.has(l1)) setL1(data[0].code);
          if (!codes.has(l2)) setL2(data[0].code);
        }
      } catch {}
      finally { setLangsLoading(false); }
    })();
  }, []);

  // Обновить языки при открытии настроек, если список пуст
  useEffect(() => {
    if (!showSettings || langs.length) return;
    (async () => {
      try {
        setLangsLoading(true);
        const res = await fetch("/api/languages");
        if (res.ok) {
          const data = await res.json();
          setLangs(data);
        }
      } catch {}
      finally { setLangsLoading(false); }
    })();
  }, [showSettings, langs.length]);

  // Инициализация прогресса из данных сервера при загрузке карточек
  useEffect(() => {
    if (!cards.length) return;
    const mapped = {};
    for (const c of cards) {
      const nextDue = c.next_due ? new Date(c.next_due).getTime() : 0;
      mapped[c.id] = {
        status: c.status || 'learn',
        knowCount: c.know_count || 0,
        nextDue
      };
    }
    setProgress(mapped);
  }, [cards]);

  // --- Добавление ---
  const startAdd = () => { setAddFront(""); setAddBack(""); setIsAdding(true); };
  const cancelAdd = () => setIsAdding(false);
  const saveAdd = async () => {
    try {
      const res = await fetch(`/api/cards?l1=${encodeURIComponent(l1)}&l2=${encodeURIComponent(l2)}` , {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ front: addFront.trim(), back: addBack.trim(), l1, l2 }),
      });
      if (!res.ok) throw new Error(`POST ${res.status}`);
      const newCard = await res.json();
      setCards(prev => [...prev, newCard]);
      const nextDue = newCard.next_due ? new Date(newCard.next_due).getTime() : 0;
      setProgress(prev => ({ ...prev, [newCard.id]: { status: newCard.status || 'learn', knowCount: newCard.know_count || 0, nextDue } }));
      setIsAdding(false);
      setIndex(cards.length);
      setShowBack(false);
    } catch (e) { setError("Не удалось добавить карточку."); }
  };

  // --- Редактирование ---
  const startEdit = () => {
    const c = cards[index];
    if (!c) return;
    setEditFront(c.front);
    setEditBack(c.back);
    setIsEditing(true);
  };
  const cancelEdit = () => setIsEditing(false);
  const saveEdit = async () => {
    const c = cards[index];
    if (!c) return;
    try {
      const res = await fetch(`/api/cards/${c.id}?l1=${encodeURIComponent(l1)}` , {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ front: editFront.trim(), back: editBack.trim(), l1 }),
      });
      if (!res.ok) throw new Error(`PUT ${res.status}`);
      const updated = await res.json();
      setCards(prev => prev.map(x => x.id === updated.id ? updated : x));
      setIsEditing(false);
      setShowBack(false);
    } catch (e) { setError("Не удалось сохранить изменения."); }
  };

  // --- Удаление ---
  const removeCard = async () => {
    const c = cards[index];
    if (!c) return;
    if (!confirm(`Удалить карточку "${c.front}"?`)) return;
    try {
      const res = await fetch(`/api/cards/${c.id}`, { method: "DELETE", headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
      if (!res.ok) throw new Error(`DELETE ${res.status}`);
      setCards(prev => {
        const next = prev.filter(x => x.id !== c.id);
        setIndex(next.length ? Math.min(index, next.length - 1) : 0);
        return next;
      });
      setProgress(prev => {
        const copy = { ...prev };
        delete copy[c.id];
        return copy;
      });
      setShowBack(false);
    } catch (e) { setError("Не удалось удалить карточку."); }
  };

  // --- Логика обучения, статусы и расписание повторений ---
  const isActiveNow = (p) => {
    if (!p) return true;
    if (p.status === 'learn') return true;
    return (p.nextDue || 0) <= Date.now();
  };

  const computeNextIndex = (currentIndex, prog) => {
    if (!cards.length) return 0;
    const now = Date.now();
    let earliestIdx = -1;
    let earliestDue = Number.POSITIVE_INFINITY;
    for (let step = 1; step <= cards.length; step++) {
      const i = (currentIndex + step) % cards.length;
      const p = prog[cards[i].id] || { status: 'learn', nextDue: 0 };
      if (p.status === 'learn') return i; // сразу доступна
      if ((p.nextDue || 0) <= now) return i; // наступил срок — доступна
      if (p.nextDue < earliestDue) { earliestDue = p.nextDue; earliestIdx = i; }
    }
    return earliestIdx !== -1 ? earliestIdx : currentIndex;
  };

  const handleKnow = () => {
    const c = cards[index];
    if (!c) return;
    const now = Date.now();
    const p = progress[c.id] || { status: 'learn', knowCount: 0, nextDue: 0 };
    const newKnowCount = (p.knowCount || 0) + 1;
    // Интервалы: 1-е нажатие 1 мин, 2-е 5 мин, 3-е 30 мин, 4-е 1 час, 5-е 1 день, далее 1 день
    const minute = 60 * 1000;
    const hour = 60 * minute;
    const day = 24 * hour;
    const schedule = [1 * minute, 5 * minute, 30 * minute, 1 * hour, 1 * day];
    const delayMs = newKnowCount <= 5 ? schedule[newKnowCount - 1] : 1 * day;
    const updatedForCard = { status: 'know', knowCount: newKnowCount, nextDue: now + delayMs };
    const updatedProgress = { ...progress, [c.id]: updatedForCard };
    setProgress(updatedProgress);
    // persist to server
    if (token) {
      fetch(`/api/cards/${c.id}/progress`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status: updatedForCard.status, knowCount: updatedForCard.knowCount, nextDue: updatedForCard.nextDue })
      }).then(r=>r.ok?r.json():null).then(() => {}).catch(() => {});
    }
    setShowBack(false);
    setIndex(computeNextIndex(index, updatedProgress));
  };

  const handleDontKnow = () => {
    const c = cards[index];
    if (!c) return;
    const updated = { status: 'learn', knowCount: 0, nextDue: 0 };
    const updatedProgress = { ...progress, [c.id]: updated };
    setProgress(updatedProgress);
    if (token) {
      fetch(`/api/cards/${c.id}/progress`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status: updated.status, knowCount: updated.knowCount, nextDue: updated.nextDue })
      }).then(r=>r.ok?r.json():null).then(() => {}).catch(() => {});
    }
    setShowBack(false);
    setIndex(computeNextIndex(index, updatedProgress));
  };

  const handleCheckAnswer = () => {
    if (!cards.length) return;
    const c = cards[index];
    const ok = (answer || "").trim().toLowerCase() === (c.front || "").trim().toLowerCase();
    setChecked(ok ? 'correct' : 'wrong');
    setAnswer("");
    setTimeout(() => {
      setChecked(null);
      if (ok) handleKnow(); else handleDontKnow();
    }, 3000);
  };

  const handleGiveUp = () => {
    if (mode !== 'typing') { handleDontKnow(); return; }
    if (checked !== null) return; // уже показана пара/в процессе
    setChecked('wrong');
    setAnswer("");
    setTimeout(() => {
      setChecked(null);
      handleDontKnow();
    }, 3000);
  };

  // Возврат статусов «Знаю»/«Выучено» в «Учить», когда наступил срок
  useEffect(() => {
    if (!cards.length) return;
    const now = Date.now();
    let changed = false;
    const next = { ...progress };
    for (const c of cards) {
      const p = next[c.id];
      if (!p) continue;
      if (p.status !== 'learn' && (p.nextDue || 0) <= now) {
        next[c.id] = { ...p, status: 'learn' };
        changed = true;
      }
    }
    if (changed) setProgress(next);
  }, [cards, progress]);

  // Вспомогательное форматирование времени до повторения
  const formatTimeUntil = (ts) => {
    const diff = ts - Date.now();
    if (diff <= 0) return "сейчас";
    const minutes = Math.round(diff / 60000);
    if (minutes < 60) return `через ${minutes}м`;
    const hours = Math.round(minutes / 60);
    return `через ${hours}ч`;
  };

  // --- Авторизация ---
  const authRequest = async (path) => {
    const res = await fetch(`${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: authEmail.trim(), password: authPassword })
    });
    if (!res.ok) {
      const msg = await res.json().catch(() => ({}));
      throw new Error(msg?.error || `Auth ${res.status}`);
    }
    return res.json();
  };

  const onLogin = async () => {
    try {
      const data = await authRequest("/api/auth/login");
      setToken(data.token);
      setUser(data.user);
      localStorage.setItem("token", data.token);
      localStorage.setItem("user", JSON.stringify(data.user));
      if (data.user?.preferred_l1) setL1(data.user.preferred_l1);
      if (data.user?.preferred_l2) setL2(data.user.preferred_l2);
      setError("");
      // после входа: если карточек нет — импортировать стартовые
      await maybeMigrateSeed(data.token);
    } catch (e) {
      setError(e.message);
    }
  };

  const onRegister = async () => {
    try {
      const data = await authRequest("/api/auth/register");
      setToken(data.token);
      setUser(data.user);
      localStorage.setItem("token", data.token);
      localStorage.setItem("user", JSON.stringify(data.user));
      setError("");
      // после регистрации: сразу импортировать стартовые
      await maybeMigrateSeed(data.token);
    } catch (e) {
      setError(e.message);
    }
  };

  const onLogout = () => {
    setToken("");
    setUser(null);
    try {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
    } catch {}
  };

  // Импорт стартовых карточек, если у пользователя их нет
  const maybeMigrateSeed = async (t) => {
    try {
      const listRes = await fetch(`/api/cards?l1=${encodeURIComponent(l1)}&l2=${encodeURIComponent(l2)}` , { headers: { Authorization: `Bearer ${t}` } });
      if (!listRes.ok) return;
      const list = await listRes.json();
      if (Array.isArray(list) && list.length === 0) {
        const res = await fetch(`/api/cards/migrate?l1=${encodeURIComponent(l1)}&l2=${encodeURIComponent(l2)}` , {
          method: "POST",
          headers: { Authorization: `Bearer ${t}` }
        });
        if (res.ok) {
          const after = await fetch(`/api/cards?l1=${encodeURIComponent(l1)}&l2=${encodeURIComponent(l2)}` , { headers: { Authorization: `Bearer ${t}` } });
          if (after.ok) {
            const data = await after.json();
            setCards(data);
          }
        }
      }
    } catch {}
  };

  // Авторежим переключения (должен быть до любого раннего return)
  useEffect(() => {
    if (!autoMode) return;
    if (!cards.length) return;
    const c = cards[index];
    if (!c) return;
    const p = progress[c.id] || { knowCount: 0 };
    const wantTyping = (p.knowCount || 0) >= 3;
    setMode(wantTyping ? 'typing' : 'card');
  }, [autoMode, cards, index, progress]);

  // Предварительно вычисляем активность и текущую карточку ДО эффекта таймера
  const visibleIndices = cards
    .map((c, i) => ({ c, i, p: progress[c.id] || { status: 'learn', nextDue: 0 } }))
    .filter(x => x.p.status === 'learn' || (x.p.nextDue || 0) <= Date.now())
    .map(x => x.i);
  const computeVisibleIndex = () => {
    if (visibleIndices.length === 0) return -1;
    const nextIdx = visibleIndices.find(i => i >= index);
    return nextIdx !== undefined ? nextIdx : visibleIndices[0];
  };
  const currentIndexResolved = computeVisibleIndex();
  const card = currentIndexResolved >= 0 ? cards[currentIndexResolved] : null;
  const showNoCardBlock = cards.length > 0 && (visibleIndices.length === 0 || currentIndexResolved === -1 || !card);

  // Пересчёт ближайшего срока следующей карточки
  useEffect(() => {
    const now = Date.now();
    let best = Infinity;
    for (const c of cards) {
      const p = progress[c.id];
      if (!p) continue;
      const due = p.nextDue || 0;
      if ((p.status !== 'learn') && due > now && due < best) best = due;
    }
    setNextDueTs(Number.isFinite(best) ? best : 0);
  }, [cards, progress]);

  // Тик таймера раз в секунду
  useEffect(() => {
    const tick = () => {
      if (!showNoCardBlock) { setCountdown("\u2014"); reloadOnceRef.current = false; return; }
      if (!nextDueTs) { setCountdown("\u2014"); return; }
      const diff = nextDueTs - Date.now();
      if (diff <= 0) {
        setCountdown("00:00:00");
        if (!reloadOnceRef.current) {
          reloadOnceRef.current = true;
          setTimeout(() => { window.location.reload(); }, 300);
        }
        return;
      }
      const totalSec = Math.floor(diff / 1000);
      const h = String(Math.floor(totalSec / 3600)).padStart(2, '0');
      const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
      const s = String(totalSec % 60).padStart(2, '0');
      setCountdown(`${h}:${m}:${s}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [nextDueTs, showNoCardBlock]);

  // Авторежим переключения (должен быть до любого раннего return)
  useEffect(() => {
    if (!autoMode) return;
    if (!cards.length) return;
    const c = cards[index];
    if (!c) return;
    const p = progress[c.id] || { knowCount: 0 };
    const wantTyping = (p.knowCount || 0) >= 3;
    setMode(wantTyping ? 'typing' : 'card');
  }, [autoMode, cards, index, progress]);
  if (loading) return <p className="p-6">Загрузка…</p>;
  const initials = user?.email ? user.email.split('@')[0].slice(0,2).toUpperCase() : null;

  

  return (
    <div className="min-h-screen flex flex-col items-center bg-gray-100 p-6">
      <div className="w-full max-w-md relative mb-4">
        <h1 className="text-2xl font-bold text-center">Amigos flashcards</h1>
        <button type="button" onClick={() => setShowSettings(true)} title="Настройки" className="p-1 rounded-full hover:bg-gray-200 absolute right-0 top-1/2 -translate-y-1/2">
          {initials ? (
            <div className="w-8 h-8 rounded-full bg-indigo-600 text-white flex items-center justify-center font-semibold">
              {initials}
            </div>
          ) : (
            <User size={22} />
          )}
        </button>
      </div>
      {error && <div className="mb-4 text-red-600">{error}</div>}

      {/* Режим всегда авторежим: переключение по прогрессу */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowSettings(false)} />
          <div className="relative w-full max-w-md bg-white rounded-xl shadow p-4">
            <div className="flex items-center justify-center mb-3">
              <h3 className="font-semibold">Профиль</h3>
            </div>
            {token && (
              <div className="mb-3 text-gray-700">Пользователь {user?.email}</div>
            )}
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-600">Знаю язык</span>
                <select value={l2} onChange={(e) => setL2(e.target.value)} className="border rounded px-2 py-2">
                  {langs.length === 0 ? (
                    <option value="" disabled>{langsLoading ? "Загрузка языков..." : "Нет языков"}</option>
                  ) : (
                    langs.map(l => (
                      <option key={l.code} value={l.code}>{l.name}</option>
                    ))
                  )}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-600">Учу язык</span>
                <select value={l1} onChange={(e) => setL1(e.target.value)} className="border rounded px-2 py-2">
                  {langs.length === 0 ? (
                    <option value="" disabled>{langsLoading ? "Загрузка языков..." : "Нет языков"}</option>
                  ) : (
                    langs.map(l => (
                      <option key={l.code} value={l.code}>{l.name}</option>
                    ))
                  )}
                </select>
              </div>
              <div className="flex justify-end gap-2 mt-4">
                <button onClick={() => setShowSettings(false)} className="px-3 py-1 rounded border">Закрыть</button>
                {token && (
                  <button onClick={onLogout} className="px-3 py-1 rounded border">Выйти</button>
                )}
                {token && (
                  <button
                    className="px-3 py-1 rounded bg-blue-600 text-white disabled:opacity-50"
                    disabled={!langs.length || !l1 || !l2}
                    onClick={async () => {
                      try {
                        const res = await fetch('http://localhost:5000/api/me', {
                          method: 'PUT',
                          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                          body: JSON.stringify({ preferred_l1: l1, preferred_l2: l2 })
                        });
                        if (res.ok) {
                          const u = await res.json();
                          setUser(prev => ({ ...prev, preferred_l1: u.preferred_l1, preferred_l2: u.preferred_l2 }));
                          localStorage.setItem('user', JSON.stringify({ ...(user || {}), preferred_l1: u.preferred_l1, preferred_l2: u.preferred_l2 }));
                          localStorage.setItem('l1', u.preferred_l1 || '');
                          localStorage.setItem('l2', u.preferred_l2 || '');
                          setShowSettings(false);
                        }
                      } catch {}
                    }}
                  >
                    Сохранить
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}


      {/* Авторизация: показывается только если не авторизован */}
      {!token && (
        <div className="w-full max-w-md bg-white p-4 rounded-xl shadow">
          <div className="flex flex-col gap-2">
            <div className="flex gap-2">
              <input
                value={authEmail}
                onChange={(e) => setAuthEmail(e.target.value)}
                className="flex-1 px-3 py-2 border rounded"
                placeholder="email"
                type="email"
              />
              <input
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                className="flex-1 px-3 py-2 border rounded"
                placeholder="пароль"
                type="password"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={onLogin} className="px-4 py-2 rounded bg-blue-600 text-white">Войти</button>
              <button onClick={onRegister} className="px-4 py-2 rounded bg-green-600 text-white">Регистрация</button>
            </div>
          </div>
        </div>
      )}

      {isEditing ? (
        <EditForm
          front={editFront}
          back={editBack}
          onFrontChange={setEditFront}
          onBackChange={setEditBack}
          onCancel={cancelEdit}
          onSave={saveEdit}
        />
      ) : isAdding ? (
        <AddForm
          front={addFront}
          back={addBack}
          onFrontChange={setAddFront}
          onBackChange={setAddBack}
          onCancel={cancelAdd}
          onSave={saveAdd}
        />
      ) : cards.length === 0 ? (
        <div className="mt-6 text-gray-600 flex flex-col items-center gap-3">
          <p>Пока нет карточек.</p>
          {token ? (
            <>
              <button
                className="px-3 py-1 rounded bg-blue-600 text-white"
                onClick={() => maybeMigrateSeed(token)}
              >
                Импортировать стартовые
              </button>
              <span className="text-sm">или добавь свои слова ниже</span>
            </>
          ) : (
            <span className="text-sm">Войдите, чтобы импортировать стартовые карточки</span>
          )}
        </div>
      ) : (
        <>
          {/* Карточка или сообщение об окончании */}
          {showNoCardBlock ? (
            <div className="w-80 mt-6 bg-blue-50 text-blue-700 px-4 py-3 rounded text-center">
              Добавьте новые слова для заучивания.
              <div className="mt-2">
                <button onClick={startAdd} className="px-3 py-1 rounded bg-blue-600 text-white">Добавить слова</button>
              </div>
            </div>
          ) : mode === 'typing' ? (
            <div className="w-80 mt-6 bg-white rounded-xl shadow-lg p-4 text-center relative">
              {checked !== null ? (
                <div className="mb-4">
                  <div className="font-semibold text-2xl">{card.front}</div>
                  <div className="text-xl text-gray-600">{card.back}</div>
                </div>
              ) : (
                <div className="text-2xl font-semibold mb-4">{card.back}</div>
              )}
              <div className="flex gap-2">
                <input
                  className={`flex-1 border rounded px-3 py-2 ${checked === 'correct' ? 'border-green-600' : checked === 'wrong' ? 'border-red-600' : ''}`}
                  placeholder="Введите слово"
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleCheckAnswer(); }}
                  disabled={checked !== null}
                />
              </div>
              {checked === 'correct' && <div className="mt-2 text-green-600 text-sm">Верно!</div>}
              {checked === 'wrong' && (
                <div className="mt-2 text-red-600 text-sm">Неверно</div>
              )}
              {checked !== null && (
                <div className="text-gray-500 mt-1 text-sm">Переход через 3 секунды…</div>
              )}
            </div>
          ) : (
            <div
              className="w-80 h-48 mt-6 flex items-center justify-center bg-white rounded-xl shadow-lg text-2xl cursor-pointer select-none"
              onClick={() => setShowBack(!showBack)}
            >
              {showBack ? (
                <div className="flex flex-col items-center gap-2 text-center px-4">
                  <div className="font-semibold">{card.front}</div>
                  <div className="text-xl text-gray-600">{card.back}</div>
                </div>
              ) : (
                card.front
              )}
            </div>
          )}

          {/* Прогресс по текущей карточке */}
          {!showNoCardBlock && card && (
            <div className="mt-2 text-sm text-gray-600">
              {(() => {
                const p = progress[card.id] || { status: 'learn', knowCount: 0, nextDue: 0 };
                const next = p.nextDue > 0 && p.status !== 'learn' ? formatTimeUntil(p.nextDue) : null;
                const statusLabel = p.status === 'learn' ? 'Учить' : p.status === 'know' ? 'Знаю' : 'Выучено';
                return (
                  <span>
                    Статус: {statusLabel} • Прогресс: {Math.min(p.knowCount || 0, 5)}/5 {next ? `• Возврат ${next}` : ""}
                  </span>
                );
              })()}
            </div>
          )}

          {/* Компонент управления обучением */}
          <LearningControls onKnow={mode === 'typing' ? handleCheckAnswer : handleKnow} onDontKnow={mode === 'typing' ? handleGiveUp : handleDontKnow} disabled={showNoCardBlock || (mode === 'typing' && checked !== null)} />

          {/* Компонент с действиями (только для авторизованных) */}
          {token && (
            <CardActions onEdit={startEdit} onAdd={startAdd} onDelete={removeCard} disableEditDelete={showNoCardBlock} />
          )}

          {/* Сообщение о выученных карточках уже показывается вместо карточки */}
        </>
      )}
      {/* Таймер ближайшей карточки: показывать только когда нет активных карточек */}
      {showNoCardBlock && (
        <div className="mt-6 text-sm text-gray-600">До ближайшей карточки: {countdown}</div>
      )}
    </div>
  );
}

// Admin language management removed for regular users
  