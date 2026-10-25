import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Caveat, Fraunces, Source_Sans_3 } from 'next/font/google';
import LandingArrange from './LandingArrange';
import styles from './landing.module.css';

const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-fraunces',
  display: 'swap',
});
const sourceSans = Source_Sans_3({
  subsets: ['latin'],
  variable: '--font-source-sans',
  display: 'swap',
});
const caveat = Caveat({
  subsets: ['latin'],
  weight: ['400', '600'],
  variable: '--font-caveat',
  display: 'swap',
});

function CTA({children='Find your people'}:{children?:React.ReactNode}) {
  return <Link className={styles.cta} href="/onboarding">{children}<ArrowRight size={16} aria-hidden="true"/></Link>;
}
type AppScreen = 'pitches'|'profile'|'invited'|'guests'|'past'|'matching'|'connection'|'threads'|'going'|'radar'|'social-pages'|'how-matching'|'how-pitch'|'how-guests';
const suppliedScreens: Partial<Record<AppScreen,{file:string;width:number;height:number}>> = {
  going: {file:'supplied-going.jpg',width:719,height:1280},
  radar: {file:'supplied-radar.jpg',width:663,height:1280},
  'social-pages': {file:'supplied-social-pages.jpg',width:672,height:1280},
  matching: {file:'supplied-matching.jpg',width:702,height:1280},
  'how-matching': {file:'supplied-how-matching.jpg',width:658,height:1280},
  'how-pitch': {file:'supplied-how-pitch.jpg',width:751,height:1280},
  'how-guests': {file:'supplied-how-guests.jpg',width:819,height:1280},
};
const screenDescriptions: Record<AppScreen,string> = {
  going: 'Confirmed Cowboy night outing with its time, place and an anonymised host',
  radar: 'On your Radar: a suggested Run at Fort Canning Park outing',
  'social-pages': 'Social Read pages: Who I am socially, My kind of closeness, What I bring and Where I come alive',
  'how-matching': 'Personal matching cards explaining why you might click and potential friction, with anonymised profiles',
  'how-pitch': 'Pitch Outing form with title, activity, location, date, time and cover image',
  'how-guests': 'Choose matches to invite from the outing guest list, with anonymised names and photos',
  profile: 'Current Social Read profile with a personal summary and scrapbook pages, using fictional sample data',
  matching: 'Current matching card with Why you might click, Potential friction and View Connection',
  threads: 'Current Connection Notes objects: explore social energy, communication and friendship style',
  connection: 'Current Connection Notes with the summary and individual thread objects',
  pitches: 'Your Pitches: gathering interest and Manage Pitch controls',
  invited: 'An outing invitation: details, Join, Pass and View Outing',
  guests: 'Invite Guests: matching profiles to invite to your outing, with anonymised names and photos',
  past: 'Past outings and Rhythm Check, with anonymised host names and photos',
};
function Phone({screen,className=''}:{screen:AppScreen;className?:string}) {
  const capture=suppliedScreens[screen];
  return <figure className={[styles.actualPreview,capture?styles.suppliedPreview:'',className].join(' ')}><div className={styles.phone}><div className={styles.screen}><img src={'/images/landing/'+(capture?.file??'current-'+screen+'.jpg')} alt={screenDescriptions[screen]} loading="lazy" width={capture?.width??390} height={capture?.height??780}/></div></div></figure>;
}
export default function LandingPageContent(){
  return <div className={styles.page} data-landing="felt">
    <a href="#main" className={styles.skip}>Skip to content</a>
    <nav className={styles.nav} aria-label="Main navigation"><a href="#features">Features</a><a href="#how">How it works</a><Link href="/onboarding">Sign up</Link></nav>
    <main id="main">
      <section className={styles.hero}>
        <img className={styles.backdrop} src="/images/landing/hero-night.jpg" alt="" fetchPriority="high"/>
        <div className={styles.heroText}>
          <h1>Not just a<br/>social app</h1>
          <p>For people between worlds, and the ones they’ll feel at home</p>
          <div className={styles.heroActions}>
            <CTA/>
            <a className={styles.ctaGhost} href="#how">See how it works</a>
          </div>
        </div>
      </section>
      <div className={[styles.scrapbook, fraunces.variable, sourceSans.variable, caveat.variable].join(' ')}>
        <section className={styles.definition} aria-labelledby="post-definition">
          <div className={styles.rewindDesk}>
            <article className={styles.notebook}>
              <img data-arrange="vinyl" className={`${styles.cutout} ${styles.objVinyl}`} src="/images/landing/artifacts/artifact-vinyl.png" alt="" width={900} height={833}/>
              <img data-arrange="books" className={`${styles.cutout} ${styles.objBooks}`} src="/images/landing/artifacts/artifact-books.png" alt="" width={900} height={623}/>
              <img data-arrange="pin" className={`${styles.cutout} ${styles.objPin}`} src="/images/landing/artifacts/artifact-pin.png" alt="" width={407} height={721}/>
              <img data-arrange="ticket" className={`${styles.cutout} ${styles.objTicket}`} src="/images/landing/artifacts/artifact-ticket.png" alt="" width={900} height={521}/>
              <p id="post-definition" className={styles.dictDef}>a thoughtful process of crafting experiences that engage people, shape clarity, and spark delights.</p>
              <img data-arrange="radio" className={`${styles.cutout} ${styles.objRadio}`} src="/images/landing/artifacts/artifact-radio.png" alt="" width={895} height={765}/>
              <img data-arrange="pinTwo" className={`${styles.cutout} ${styles.objPinTwo}`} src="/images/landing/artifacts/artifact-pin.png" alt="" width={407} height={721}/>
              <img data-arrange="cassette" className={`${styles.cutout} ${styles.objCassette}`} src="/images/landing/artifacts/artifact-cassette.png" alt="" width={880} height={535}/>
              <div data-arrange="film" className={styles.filmReel} aria-hidden="true">
                <img src="/images/landing/hero-walk.jpg" alt="" width={420} height={280}/>
                <img src="/images/landing/artifacts/artifact-butterfly.png" alt="" width={900} height={635}/>
              </div>
              <img data-arrange="butterfly" className={`${styles.cutout} ${styles.objButterfly}`} src="/images/landing/artifacts/artifact-butterfly.png" alt="" width={900} height={635}/>
              <img data-arrange="rose" className={`${styles.cutout} ${styles.objRose}`} src="/images/landing/artifacts/artifact-rose.png" alt="" width={606} height={810}/>
              <img data-arrange="camera" className={`${styles.cutout} ${styles.objCamera}`} src="/images/landing/artifacts/artifact-camera.png" alt="" width={900} height={632}/>
              <span data-arrange="barcode" className={styles.barcode} aria-hidden="true"/>
            </article>
          </div>
        </section>
        <section className={styles.hostsCard} aria-labelledby="together-heading">
          <div className={styles.scallop}>
            <p className={styles.trackEyebrow}>Outings</p>
            <h2 id="together-heading">Something to do together.</h2>
            <p className={styles.hostsCopy}>A little self-understanding. A few people worth meeting.</p>
            <div className={styles.filmStrip} aria-hidden="true">
              <img src="/images/landing/scene-run.jpg" alt="" width={320} height={213}/>
              <img src="/images/landing/scene-studio.jpg" alt="" width={320} height={213}/>
              <img src="/images/landing/scene-night.jpg" alt="" width={320} height={213}/>
            </div>
            <p className={styles.heartSticker}>sunday<br/>together</p>
            <div className={styles.phoneScatter}><Phone screen="going" className={styles.behind}/><Phone screen="radar" className={styles.front}/></div>
          </div>
        </section>
        <section id="features" className={styles.features}>
          <div className={styles.featureStory}>
            <article className={styles.storyRow}><div className={styles.storyVisual}><Phone screen="social-pages"/><p className={styles.caption}>Your Social Read · Your profile</p></div><div className={styles.storyCopy}><small>01 · YOUR SOCIAL READ</small><h3>A read on the way you move through friendship.</h3><p>Some people need constant contact. Some can disappear for weeks and come back like nothing happened. Some come alive around a crowded table; others need one good conversation in the corner.</p><p>Your Social Read brings together what you share: what draws you to people, what you value in friendship, your social rhythm and the things that make you want to leave the house.</p><strong>Six questions give us somewhere to start. Your Tribal Pass lets the picture get sharper over time.</strong></div></article>
            <article className={styles.storyRow}><div className={styles.storyVisual}><Phone screen="matching"/><p className={styles.caption}>Why you might click · Potential friction · View Connection</p></div><div className={styles.storyCopy}><small>02 · MATCHING & RESONANCE</small><h3>Not everyone you like is like you.</h3><p>Sometimes you click because you move through the world in similar ways. Sometimes a difference gives you something worth exploring.</p><p>Soul Tribe uses the profile signals you share, your interests, friendship preferences, social rhythm and life context, to surface people worth meeting. Connection Notes help you see what connects you and where expectations differ.</p><strong>Not a compatibility percentage. A reason to look twice.</strong></div></article>
            <article className={styles.storyRow}><div className={styles.storyVisual}><div className={styles.matchPair}><Phone screen="connection"/><Phone screen="threads"/></div><p className={styles.caption}>Connection Notes · Thread by thread</p></div><div className={styles.storyCopy}><small>03 · VIEW CONNECTION</small><h3>See what exists between you.</h3><p>A profile tells you about a person. Your connection tells you about the two of you.</p><p>Open View Connection from a profile to explore where your patterns meet: what may feel easy, where you might rub, and what you could enjoy doing together. As you share more, there’s more to draw on.</p><strong>Knowing someone is interesting is different from knowing why the two of you might work.</strong></div></article>
            <article className={styles.storyRow}><div className={styles.storyVisual}><Phone screen="pitches"/><p className={styles.caption}>Your Pitches · Manage your outings</p></div><div className={styles.storyCopy}><small>04 · PITCH AN OUTING</small><h3>Have a plan.<br/>Missing the people?</h3><p>A gallery this afternoon. Padel tomorrow. Drinks after work. A beach day because Sunday suddenly opened up.</p><p>Pitch it when the thought happens. Choose what you’re doing, where, when and how many people you want around. Invite people or let them ask to join.</p><p>As requests come in, you decide who comes. Open their profile. See your connection. Choose the group you want to bring together.</p><strong>The point isn’t to collect matches. It’s to give them somewhere to become real.</strong></div></article>
          </div>
        </section>
        <section id="how" className={styles.how}>
          <img className={styles.backdrop} src="/images/early-read/shore.jpg" alt="" loading="lazy"/>
          <div className={styles.sectionHeading}><h2>How it works</h2><p>A little self-understanding. A few people worth meeting. Something to do together.</p></div>
          <div className={styles.howSteps}>
            <article><Phone screen="how-matching"/><div><small>01</small><h3>Precise matching</h3><p>Your interests, friendship preferences and social rhythm help surface people worth meeting. Read why you might click and where expectations could differ.</p></div></article>
            <article><Phone screen="how-pitch"/><div><small>02</small><h3>Pitch an outing</h3><p>Add an activity, a place and a time. Set the group size and share what you have in mind.</p></div></article>
            <article><Phone screen="how-guests"/><div><small>03</small><h3>Choose your matches</h3><p>Select the people you want to invite from your matches, then publish your outing proposal.</p></div></article>
          </div>
          <h2 className={styles.realLife}>The rest happens in real life.</h2>
        </section>
        <section className={styles.outingGallery}>
          <div className={styles.sectionHeading}><h2>From an invitation<br/>to a shared memory.</h2><p>Your invitations, your pitches, and the evenings that already happened, all in one place.</p></div>
          <div className={styles.moodboard}>
            <figure className={`${styles.boardPolaroid} ${styles.tileWalk}`}>
              <img src="/images/landing/hero-walk.jpg" alt="" width={420} height={280} loading="lazy"/>
              <figcaption>between worlds</figcaption>
            </figure>
            <figure className={`${styles.boardPolaroid} ${styles.tileCafe}`}>
              <img src="/images/landing/scene-cafe.jpg" alt="" width={640} height={427} loading="lazy"/>
              <figcaption>coffee first</figcaption>
            </figure>
            <div className={styles.envelope} aria-hidden="true">
              <p>Sunday outing</p>
              <span>ordinary evenings</span>
            </div>
            <div className={styles.memoryPreview}><img src="/images/landing/supplied-memory-phone.jpg" alt="Outing invitation shown on a phone, with a sunset skating photo in the Polaroid" width="430" height="728" loading="lazy"/></div>
            <figure className={`${styles.boardPolaroid} ${styles.tileRun}`}>
              <img src="/images/landing/scene-run.jpg" alt="" width={640} height={427} loading="lazy"/>
              <figcaption>keep moving</figcaption>
            </figure>
            <figure className={`${styles.boardPolaroid} ${styles.tileStudio}`}>
              <img src="/images/landing/scene-studio.jpg" alt="" width={640} height={427} loading="lazy"/>
              <figcaption>slow studio</figcaption>
            </figure>
            <figure className={`${styles.boardPolaroid} ${styles.tileNight}`}>
              <img src="/images/landing/scene-night.jpg" alt="" width={640} height={427} loading="lazy"/>
              <figcaption>golden hour</figcaption>
            </figure>
            <p className={styles.botanical} aria-hidden="true">✿</p>
            <p className={styles.doily} aria-hidden="true"/>
            <p className={styles.inviteCard}>Friday · a small table<br/>Free drinks from whoever brought cake</p>
            <p className={styles.memoryNote}>the evening that already happened</p>
          </div>
        </section>
        <section id="faq" className={styles.faq}><h2>Frequently Asked Questions</h2>{[
          ['Is Soul Tribe for dating?','No. It’s for friendship: people to share an interest, an ordinary evening or a new chapter with.'],
          ['What makes a match personal?','Your profile brings together interests, friendship preferences and social rhythm. Connection Notes show what you share and where expectations differ.'],
          ['Can I make a plan for today?','Yes. Pitch an activity with a time and place, or request to join an upcoming outing. Plans depend on who is available and the host confirming the group.'],
          ['How do I get started?','Answer six questions and see your early read. Then create an account and save your profile to explore people and outings. Soul Tribe is for adults aged 18 and over.']
        ].map(([q,a])=><details key={q}><summary>{q}<span aria-hidden="true">+</span></summary><p>{a}</p></details>)}</section>
        <section className={styles.closing}><h2>Find your people.</h2><p>The ones who share your depth, your rhythm,<br/>and a little room in their lives.</p><CTA>Get my early read</CTA><div className={styles.photoFan}>{['seaside','sunset','evening'].map(name=><img key={name} src={'/images/early-read/'+name+'.jpg'} alt="" loading="lazy"/>)}</div></section>
      </div>
    </main>
    <footer className={`${styles.footer} ${styles.scrapbookFooter}`}><p>More time together, outside the app.</p><div><a href="#features">Features</a><a href="#how">How it works</a><a href="#faq">FAQ</a><Link href="/auth/signin">Log in</Link></div></footer>
    <LandingArrange/>
  </div>;
}
