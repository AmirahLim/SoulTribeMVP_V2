'use client';

import {useEffect, useState} from 'react';
import styles from './landing.module.css';

const KEY = 'soul-tribe-landing-arrange';

type Pos = {left: string; top: string};
type Store = Record<string, Pos>;

function load(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) as Store : {};
  } catch {
    return {};
  }
}

function save(store: Store) {
  localStorage.setItem(KEY, JSON.stringify(store));
}

function apply(store: Store) {
  for (const [id, pos] of Object.entries(store)) {
    const el = document.querySelector<HTMLElement>(`[data-arrange="${id}"]`);
    if (!el) continue;
    el.style.right = 'auto';
    el.style.bottom = 'auto';
    el.style.left = pos.left;
    el.style.top = pos.top;
  }
}

export default function LandingArrange() {
  const [allowed, setAllowed] = useState(false);
  const [on, setOn] = useState(false);

  useEffect(() => {
    const host = window.location.hostname;
    const edit = new URLSearchParams(window.location.search).has('edit');
    const ok = edit || host === 'localhost' || host === '127.0.0.1';
    setAllowed(ok);
    if (!ok) return;
    apply(load());
    if (edit) setOn(true);
  }, []);

  useEffect(() => {
    if (!on) return;
    const items = [...document.querySelectorAll<HTMLElement>('[data-arrange]')];
    const cleanups: Array<() => void> = [];

    for (const el of items) {
      el.style.cursor = 'grab';
      el.style.pointerEvents = 'auto';
      el.style.touchAction = 'none';

      const onDown = (event: PointerEvent) => {
        if (event.button !== 0) return;
        event.preventDefault();
        const parent = el.offsetParent as HTMLElement | null;
        if (!parent) return;
        const parentBox = parent.getBoundingClientRect();
        const box = el.getBoundingClientRect();
        const startX = event.clientX;
        const startY = event.clientY;
        const origLeft = box.left - parentBox.left;
        const origTop = box.top - parentBox.top;
        el.setPointerCapture(event.pointerId);
        el.style.cursor = 'grabbing';
        el.style.right = 'auto';
        el.style.bottom = 'auto';
        el.style.zIndex = '20';

        const onMove = (move: PointerEvent) => {
          el.style.left = `${origLeft + (move.clientX - startX)}px`;
          el.style.top = `${origTop + (move.clientY - startY)}px`;
        };

        const onUp = () => {
          el.releasePointerCapture(event.pointerId);
          el.style.cursor = 'grab';
          el.removeEventListener('pointermove', onMove);
          el.removeEventListener('pointerup', onUp);
          const id = el.dataset.arrange;
          if (!id) return;
          const width = parent.clientWidth || 1;
          const height = parent.clientHeight || 1;
          const next = load();
          next[id] = {
            left: `${(parseFloat(el.style.left) / width) * 100}%`,
            top: `${(parseFloat(el.style.top) / height) * 100}%`,
          };
          save(next);
          el.style.left = next[id].left;
          el.style.top = next[id].top;
        };

        el.addEventListener('pointermove', onMove);
        el.addEventListener('pointerup', onUp);
      };

      el.addEventListener('pointerdown', onDown);
      cleanups.push(() => {
        el.removeEventListener('pointerdown', onDown);
        el.style.cursor = '';
        el.style.touchAction = '';
      });
    }

    return () => cleanups.forEach((fn) => fn());
  }, [on]);

  if (!allowed) return null;

  return (
    <div className={styles.arrangeBar} role="region" aria-label="Arrange landing pieces">
      <button type="button" onClick={() => setOn((value) => !value)}>
        {on ? 'Done arranging' : 'Arrange pieces'}
      </button>
      {on ? (
        <button
          type="button"
          data-secondary=""
          onClick={() => {
            localStorage.removeItem(KEY);
            window.location.reload();
          }}
        >
          Reset
        </button>
      ) : null}
      <span>{on ? 'Drag any object. Layout stays in this browser.' : 'Move the collage yourself.'}</span>
    </div>
  );
}
