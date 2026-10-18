'use client';

import {useEffect, useId, useRef, useState} from 'react';
import type {KeyboardEvent} from 'react';
import {Dialog} from 'radix-ui';
import {Check, ScanFace, X} from 'lucide-react';
import {AVATAR_FRAMES, normalizeAvatarFrame} from '../../lib/avatar-frames.mjs';
import {AvatarFrame} from './avatar-frame';
import './avatar-frame-picker.css';

const choices = [{id: 'none', name: 'Çerçevesiz'}, ...AVATAR_FRAMES];
type PickerProps = {
  frameId: string | null | undefined;
  userId: string;
  accountScope: string;
  displayName: string;
  avatar: string | null;
  disabled?: boolean;
  onSave: (frameId: string, signal: AbortSignal) => Promise<string>;
};

function initials(name: string) {
  return name.trim().split(/\s+/).map(part => [...part][0]).slice(0, 2).join('').toLocaleUpperCase('tr-TR') || 'A';
}

function PreviewAvatar({avatar, displayName, frameId}: Pick<PickerProps, 'avatar' | 'displayName' | 'frameId'>) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [avatar]);
  return <span className="at-frame-avatar" aria-hidden="true">
    <span>{initials(displayName)}</span>
    {avatar && !failed && <img src={avatar} alt="" onError={() => setFailed(true)}/>}
    <AvatarFrame frameId={frameId}/>
  </span>;
}

export default function AvatarFramePicker({frameId, userId, accountScope, displayName, avatar, disabled = false, onSave}: PickerProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => normalizeAvatarFrame(frameId));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const grid = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const scope = userId + ':' + accountScope;
  const request = useRef({scope, alive: true, sequence: 0, controller: null as AbortController | null});
  if (request.current.scope !== scope) {
    request.current.alive = false;
    request.current.sequence++;
    request.current.controller?.abort();
    request.current = {scope, alive: true, sequence: request.current.sequence, controller: null};
  }
  useEffect(() => {
    const lifecycle = request.current;
    lifecycle.alive = true;
    return () => {lifecycle.alive = false; lifecycle.sequence++; lifecycle.controller?.abort();};
  }, [scope]);
  const saved = normalizeAvatarFrame(frameId);
  const selected = choices.find(frame => frame.id === draft) || choices[0];
  function changeOpen(next: boolean) {
    if (request.current.controller) return;
    if (next) {
      if (disabled) return;
      setDraft(saved); setError('');
    }
    setOpen(next);
  }
  function choose(id: string) {
    if (request.current.controller) return;
    setDraft(id); setError('');
  }
  function move(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.altKey || event.ctrlKey || event.metaKey || saving) return;
    const columns = grid.current ? getComputedStyle(grid.current).gridTemplateColumns.split(' ').filter(Boolean).length || 4 : 4;
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % choices.length;
    else if (event.key === 'ArrowLeft') next = (index + choices.length - 1) % choices.length;
    else if (event.key === 'ArrowDown') next = (index + columns) % choices.length;
    else if (event.key === 'ArrowUp') next = (index + choices.length - columns) % choices.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = choices.length - 1;
    else return;
    event.preventDefault();
    choose(choices[next].id);
    grid.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
  }
  async function save() {
    const lifecycle = request.current;
    if (disabled || lifecycle.controller || draft === saved) return;
    const controller = new AbortController(), sequence = ++lifecycle.sequence;
    lifecycle.controller = controller;
    const current = () => lifecycle.alive && request.current === lifecycle && lifecycle.sequence === sequence && !controller.signal.aborted;
    setSaving(true); setError('');
    try {
      const accepted = await onSave(draft, controller.signal);
      if (!current()) return;
      if (accepted !== draft) throw new Error('Çerçeven kaydedilemedi. Tekrar deneyebilirsin.');
      setOpen(false);
    } catch (reason) {
      if (current()) setError(reason instanceof Error ? reason.message : 'Çerçeven kaydedilemedi. Tekrar deneyebilirsin.');
    } finally {
      if (current()) {lifecycle.controller = null; setSaving(false);}
    }
  }
  return <Dialog.Root open={open} onOpenChange={changeOpen}>
    <Dialog.Trigger type="button" className="at-outline-button at-frame-trigger" disabled={disabled}><ScanFace size={14}/>Çerçeveyi değiştir</Dialog.Trigger>
    <Dialog.Portal>
      <Dialog.Overlay className="at-frame-overlay"/>
      <Dialog.Content className="at-frame-dialog" aria-labelledby={titleId} aria-busy={saving} aria-describedby={descriptionId} onOpenAutoFocus={event => {event.preventDefault();grid.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();}} onEscapeKeyDown={event => {if (saving) event.preventDefault();}} onInteractOutside={event => {if (saving) event.preventDefault();}}>
        <header className="at-frame-heading">
          <div><span className="at-frame-overline">PROFİLİNE SON DOKUNUŞ</span><Dialog.Title id={titleId}>Profil çerçeveni seç</Dialog.Title><Dialog.Description id={descriptionId}>Bir çerçeve seç, profilindeki görünümünü incele ve beğendiğini kaydet.</Dialog.Description></div>
          <Dialog.Close type="button" className="at-frame-close" disabled={saving} aria-label="Çerçeve seçimini kapat"><X size={17}/></Dialog.Close>
        </header>
        <div className="at-frame-scroll">
          <div className="at-frame-preview"><PreviewAvatar avatar={avatar} displayName={displayName} frameId={draft}/><div className="at-frame-preview-copy"><span>Önizleme</span><strong aria-live="polite">{selected.name}</strong><small>Seçimin kaydettiğinde profilinde ve üst menüde görünür.</small></div></div>
          <div ref={grid} className="at-frame-grid" role="radiogroup" aria-label="Profil çerçevesi" aria-busy={saving}>
            {choices.map((frame, index) => <button key={frame.id} type="button" role="radio" aria-checked={draft === frame.id} tabIndex={draft === frame.id ? 0 : -1} disabled={saving} className={'at-frame-choice' + (draft === frame.id ? ' is-selected' : '')} onClick={() => choose(frame.id)} onKeyDown={event => move(event, index)}>
              <PreviewAvatar avatar={avatar} displayName={displayName} frameId={frame.id}/>
              <span className="at-frame-choice-name">{frame.name}</span>
              {draft === frame.id && <span className="at-frame-choice-check" aria-hidden="true"><Check size={11} strokeWidth={3}/></span>}
            </button>)}
          </div>
        </div>
        {error && <p className="at-frame-feedback" role="alert">{error}</p>}
        <footer className="at-frame-footer"><span>{saving ? 'Seçimin kaydediliyor…' : 'Kaydetmeden önce özgürce dene.'}</span><Dialog.Close type="button" className="at-frame-cancel" disabled={saving}>Vazgeç</Dialog.Close><button type="button" className="at-frame-save" disabled={saving || draft === saved} onClick={() => void save()}>{saving ? 'Kaydediliyor…' : 'Kaydet'}<Check size={14}/></button></footer>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}

