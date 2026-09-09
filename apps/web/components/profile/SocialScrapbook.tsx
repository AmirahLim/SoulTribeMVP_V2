'use client';
import React, {useRef, useState, useEffect, useId} from 'react';
import Link from 'next/link';
import {Caveat} from 'next/font/google';
import {brief, type SocialPage} from '../../lib/socialScrapbook';
import styles from './SocialScrapbook.module.css';

const handwriting = Caveat({subsets: ['latin'], weight: ['400', '600']});
type Props = {
  name: string; handle?: string; area?: string; avatar?: string; bio?: string;
  headline?: string; summary?: string; pages: SocialPage[]; own?: boolean;
  earlyReadHref?: string; onEdit?: () => void; children?: React.ReactNode;
};
export function SocialScrapbook({name, handle, area, avatar, bio, headline, summary, pages, own = false, earlyReadHref, onEdit, children}: Props) {
  const [opened, setOpened] = useState<SocialPage | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  useEffect(() => { if (opened) dialog.current?.showModal(); }, [opened]);
  const empty = own ? 'This page is still unfolding. A few more answers will help us understand this part of you.' : 'They haven’t shared this part of their story yet.';
  return <div className={styles.scene}>
    <div className={styles.album}>
      <div className={styles.topline}><span>SOUL TRIBE / {own ? 'YOUR SOCIAL STORY' : 'A SOCIAL STORY'}</span>{onEdit && <button onClick={onEdit} aria-label="Open settings">Settings ↗</button>}</div>
      <header className={styles.hero}>
        <div className={styles.identity}>
          <figure className={styles.portrait}>
            {avatar ? <img src={avatar} alt={`${name}’s profile photo`} /> : <div className={styles.initial}>{name.slice(0, 1) || '✳'}</div>}
          </figure>
          <div className={styles.name}>
            <p className={styles.eyebrow}>{own ? 'A LITTLE MORE YOU' : 'NICE TO MEET YOU'}</p>
            <p className={styles.identityLabel}>Display name</p>
            <h1>{name}</h1>
            {handle && <p className={styles.username}><span>Unique username</span> @{handle.replace(/^@/, '')}</p>}
            {area && <p className={styles.area}>{area}</p>}
            <p className={styles.standing}>Tribal standing <span>Not available yet</span></p>
          </div>
        </div>
        <div className={styles.intro}>
          {!own && <p className={`${styles.handwritten} ${handwriting.className}`}>there’s a whole person here.</p>}
          <h2>{headline || (own ? 'Your story is still unfolding.' : 'Getting to know them, gently.')}</h2>
          <p className={styles.summaryBody}>{summary ? summary.split(/\n\n+/)[0] : own ? 'Six questions are a beginning, not the whole of you. Your Social Read grows with what you choose to share.' : 'Open the little pages below to discover what they’ve chosen to share about friendship.'}</p>
          {summary && summary.includes('\n\n') && <details className={styles.summaryMore}><summary>Read the rest</summary><p className={styles.summaryBody}>{summary.split(/\n\n+/).slice(1).join('\n\n')}</p></details>}
          {bio && <details className={styles.summaryMore}><summary>{own ? 'In my own words' : 'In their own words'}</summary><p>{bio}</p></details>}
          {earlyReadHref && <Link className={styles.earlyRead} href={earlyReadHref}>{own ? 'View my Early Read →' : `View ${name}’s Early Read →`}</Link>}
          {own && <Link className={styles.deepen} href="/you/deeper">You’re more than six answers. Go a little deeper ↗</Link>}
        </div>
      </header>
      <section aria-labelledby="social-pages-title" className={styles.pagesSection}>
        <div className={styles.sectionLabel}><h2 id="social-pages-title">Little pages of {own ? 'you' : name}</h2><span className={handwriting.className}>pick one to unfold ↓</span></div>
        <div className={styles.grid}>
          {pages.map((page, index) => <button key={page.key} className={`${styles.card} ${styles[page.kind]} ${page.key === 'between' ? styles.between : ''}`} onClick={() => setOpened(page)} aria-haspopup="dialog">
            {page.kind === 'photo' && <div className={styles.photoWindow}><img src={`/images/early-read/${page.key === 'social' ? 'seaside' : 'sunset'}.jpg`} alt="" loading="lazy" /><span className={handwriting.className}>{page.key === 'social' ? 'a little closer' : 'room to be yourself'}</span></div>}
            {page.kind === 'letter' && <span className={`${styles.letterMark} ${handwriting.className}`} aria-hidden="true">{page.key === 'between' ? 'you & me' : 'a note to keep'}</span>}
            {page.kind === 'notebook' && <span className={`${styles.bookMark} ${handwriting.className}`} aria-hidden="true">{page.key === 'doing' ? 'shall we?' : 'in my own time.'}</span>}
            <span className={styles.cardLabel}>{String(index + 1).padStart(2, '0')} / {page.caption}</span>
            <h3>{page.title}</h3>
            <p className={styles.preview}>{page.notes.length ? brief(page.notes[0], 85) : own ? 'A page still waiting to be written.' : 'A little more to discover.'}</p>
            <span className={styles.open}>Unfold <span aria-hidden="true">↗</span></span>
          </button>)}
        </div>
      </section>
      {children && <div className={styles.extras}>{children}</div>}
    </div>
    <dialog ref={dialog} aria-labelledby={headingId} className={styles.sheet} onClose={() => setOpened(null)}>
      {opened && <><button className={styles.close} onClick={() => dialog.current?.close()} aria-label="Close this page">✕</button><p className={styles.eyebrow}>{opened.caption}</p><h2 id={headingId}>{opened.title}</h2>
        {opened.notes.length ? opened.notes.map((note, i) => <p key={i} className={styles.note}>{note}</p>) : <p className={styles.note}>{empty}</p>}
        {!!opened.evidence?.length && <details className={styles.summaryMore}><summary>What this reading draws on</summary>{opened.evidence.map(source=><p key={source.subject+source.questionId}>{source.selections.join(' · ')}<br/><small>{source.questionId} · {source.questionVersion===null?'Original question version not recorded':`Question version ${source.questionVersion}`}</small></p>)}</details>}
        <p className={styles.disclaimer}>{own ? 'A read on what you’ve shared, not a fixed definition of you.' : 'Shared preferences are a starting point, not a complete picture of a person.'}</p>
        {opened.href && <Link className={styles.sheetLink} href={opened.href}>{opened.action}</Link>}
      </>}
    </dialog>
  </div>;
}
