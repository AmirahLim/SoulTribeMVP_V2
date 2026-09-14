'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import keepsake from '../../components/EventKeepsake.module.css';
import story from './HomeStory.module.css';
import { PitchCard, Button } from '@soul-tribe/ui';
import { getLastSpatialPoolSize, getRankedMatches, RankedMatch, countRealMembers, isSmallCommunityMode, getTribalPassStatusCopy } from '../../lib/matching';
import { resolveMatchListState } from '../../lib/matchListState';
import { fetchGoingOutings, fetchRadarOutings, fetchUserPitches, OutingItem, getOutingCategoryImage } from '../../lib/outingsStore';
import { motion } from 'framer-motion';
import { Plus, Users, MapPin, Calendar, CheckCircle2, Sparkles, Compass, AlertCircle, Edit3, Trash2 } from 'lucide-react';
import { getUserProfile, setUserProfile, UserProfileData, getUserPitches, PitchedOuting, DEFAULT_PITCHES, DEFAULT_USER_PROFILE, getJoinedOutingsLocal, addJoinedOutingLocal, removeJoinedOutingLocal, removeUserPitchLocal } from '../../lib/userStore';
import { useAuth } from '../../lib/authContext';
import { getSupabaseBrowserClient, checkIsSupabaseConfigured } from '../../lib/supabase';
import { AuthGuard } from '../../components/AuthGuard';
import {MatchKeepsake} from '../../components/MatchKeepsake';
import {MatchListNotice} from '../../components/MatchListNotice';
import { OutingCoverHeader } from '../../components/OutingCoverHeader';

import { useSearchParams } from 'next/navigation';

export default function HomeDashboardPage() {
  return (
    <AuthGuard>
      <HomeContent />
    </AuthGuard>
  );
}

function HomeContent() {
  const { user, isSupabaseConfigured } = useAuth();
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<'matches' | 'pitches' | 'going' | 'radar'>('matches');
  const [profile, setProfileState] = useState<UserProfileData>(DEFAULT_USER_PROFILE);

  useEffect(() => {
    const tabParam = searchParams.get('tab');
    if (tabParam === 'pitches' || tabParam === 'going' || tabParam === 'radar' || tabParam === 'matches') {
      setActiveTab(tabParam);
    }
  }, [searchParams]);

  // Dynamic Tab Data State
  const [matches, setMatches] = useState<RankedMatch[]>([]);
  const [pitches, setPitches] = useState<PitchedOuting[]>([]);
  const [goingOutings, setGoingOutings] = useState<OutingItem[]>([]);
  const [radarOutings, setRadarOutings] = useState<OutingItem[]>([]);
  const [isSmallCommunity, setIsSmallCommunity] = useState<boolean>(false);

  const [loading, setLoading] = useState(true);
  // Kept as the thrown value, not a string, so a missing location stays
  // distinguishable from a genuine failure.
  const [loadError, setLoadError] = useState<unknown>(null);
  const [spatialPoolSize, setSpatialPoolSize] = useState<number | null>(null);
  const [pitchesError, setPitchesError] = useState<string | null>(null);
  const [goingError, setGoingError] = useState<string | null>(null);
  const [radarError, setRadarError] = useState<string | null>(null);
  const [reloadTrigger, setReloadTrigger] = useState<number>(0);
  const [radarJoined, setRadarJoined] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        setLoadError(null);
        setPitchesError(null);
        setGoingError(null);
        setRadarError(null);

        let userProf = getUserProfile();

        if (user?.id && isSupabaseConfigured) {
          try {
            const client = getSupabaseBrowserClient();
            const { data: remoteProfile } = await client
              .from('profiles')
              .select('*')
              .eq('id', user.id)
              .maybeSingle();

            if (remoteProfile) {
              userProf = setUserProfile({
                ...userProf,
                displayName: remoteProfile.display_name || userProf.displayName,
                homeArea: remoteProfile.home_area || userProf.homeArea,
                avatarUrl: remoteProfile.avatar_url || userProf.avatarUrl,
                bio: remoteProfile.bio || userProf.bio,
                handle: remoteProfile.handle || userProf.handle,
              });
            }
          } catch {
            // Ignore DB sync errors
          }
        }

        setProfileState(userProf);

        // 1. Pitches query
        try {
          const userPitchesData = await fetchUserPitches(user?.id);
          const localPitchesList = getUserPitches();
          const formattedPitches: PitchedOuting[] = userPitchesData.map((p) => {
            const matchLocal = localPitchesList.find((lp) => lp.id === p.id);
            return {
              id: p.id,
              title: p.title,
              pitch: p.pitch,
              area: p.area,
              dateTime: p.dateTime,
              hostName: p.hostName,
              hostAvatar: p.hostAvatar,
              seatsTotal: p.seatsTotal,
              seatsFilled: p.seatsFilled,
              cohesionScore: 85,
              joinedGuests: matchLocal?.joinedGuests || [],
              createdAt: matchLocal?.createdAt || '',
              cover_image_url: p.cover_image_url || matchLocal?.cover_image_url,
              cover_image_thumb_url: p.cover_image_thumb_url || matchLocal?.cover_image_thumb_url,
              cover_image_alt: p.cover_image_alt || matchLocal?.cover_image_alt,
              cover_photographer_name: p.cover_photographer_name || matchLocal?.cover_photographer_name,
              cover_photographer_url: p.cover_photographer_url || matchLocal?.cover_photographer_url,
              cover_download_location: p.cover_download_location || matchLocal?.cover_download_location,
              category: p.category || (matchLocal as any)?.category,
            };
          });
          if (!cancelled) setPitches(formattedPitches);
        } catch (err: any) {
          if (!cancelled) setPitchesError(err?.message || 'Failed to fetch user pitches');
        }

        // 2. Matches query
        try {
          const realCount = await countRealMembers(userProf.homeArea || 'Singapore');
          const smallMode = isSmallCommunityMode(realCount);
          if (!cancelled) setIsSmallCommunity(smallMode);

          const rankedMatchesData = await getRankedMatches(userProf);
          if (!cancelled) {
            setMatches(rankedMatchesData);
            setSpatialPoolSize(getLastSpatialPoolSize());
          }
        } catch (err: unknown) {
          if (!cancelled) {
            setMatches([]);
            setLoadError(err);
          }
        }

        // 3. Going query
        try {
          const goingData = await fetchGoingOutings(user?.id);
          if (!cancelled) setGoingOutings(goingData);

          const initialJoinedMap: Record<string, boolean> = {};
          const localJoinedList = getJoinedOutingsLocal();
          localJoinedList.forEach((id) => {
            initialJoinedMap[id] = true;
          });
          goingData.forEach((g) => {
            initialJoinedMap[g.id] = true;
          });
          if (!cancelled) setRadarJoined(initialJoinedMap);
        } catch (err: any) {
          if (!cancelled) setGoingError(err?.message || 'Failed to fetch attending outings');
        }

        // 4. Radar query
        try {
          const radarData = await fetchRadarOutings(user?.id);
          if (!cancelled) setRadarOutings(radarData);
        } catch (err: any) {
          if (!cancelled) setRadarError(err?.message || 'Failed to fetch radar outings');
        }
      } catch (err: any) {
        console.error('[SoulTribe Error] Failed to load home dashboard data:', err);
        if (!cancelled) {
          setLoadError(err?.message || "Couldn't load dashboard data right now");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user?.id, reloadTrigger]);

  const matchListState = resolveMatchListState({
    loading, error: loadError, matchCount: matches.length, spatialPoolSize,
  });

  const handleToggleRadarJoin = async (outingId: string) => {
    const isCurrentlyJoined = Boolean(radarJoined[outingId]);
    const targetUserId = user?.id || profile.id;

    // Optimistic UI update
    setRadarJoined((prev) => ({ ...prev, [outingId]: !isCurrentlyJoined }));

    if (!isCurrentlyJoined) {
      addJoinedOutingLocal(outingId);
    } else {
      removeJoinedOutingLocal(outingId);
    }

    if (checkIsSupabaseConfigured()) {
      try {
        const client = getSupabaseBrowserClient();
        let dbUserId = user?.id;

        if (!dbUserId) {
          const { data: { session } } = await client.auth.getSession();
          dbUserId = session?.user?.id;
        }

        if (!dbUserId) {
          dbUserId = targetUserId;
        }

        if (dbUserId) {
          if (!isCurrentlyJoined) {
            const { error } = await client.from('outing_members').insert({
              outing_id: outingId,
              user_id: dbUserId,
              role: 'guest',
              state: 'requested',
            });
            if (error && !error.message.includes('duplicate')) {
              console.error('[SoulTribe Error] Failed to insert radar join:', error.message);
            }
          } else {
            await client
              .from('outing_members')
              .delete()
              .eq('outing_id', outingId)
              .eq('user_id', dbUserId);
          }
        }
      } catch (err) {
        console.error('[SoulTribe Error] Failed to update radar join status:', err);
      }
    }

    const updatedGoing = await fetchGoingOutings(targetUserId);
    setGoingOutings(updatedGoing);
  };

  const handleDeletePitch = async (outingId: string) => {
    if (!confirm('Are you sure you want to delete this pitched outing?')) return;

    const targetUserId = user?.id || profile.id;

    if (checkIsSupabaseConfigured()) {
      try {
        const client = getSupabaseBrowserClient();
        await client.from('outing_members').delete().eq('outing_id', outingId);
        await client.from('outings').delete().eq('id', outingId);
      } catch (err) {
        console.error('[SoulTribe Error] Failed to delete pitch from Supabase:', err);
      }
    }

    removeUserPitchLocal(outingId);
    removeJoinedOutingLocal(outingId);

    setPitches((prev) => prev.filter((p) => p.id !== outingId));
    const updatedGoing = await fetchGoingOutings(targetUserId);
    setGoingOutings(updatedGoing);
  };

  return (
    <div className="relative min-h-screen w-full bg-black text-[#FFFDF9] pb-24">
      {/* PAGE CANVAS BACKGROUND */}
      <img
        src="/user-home-bg.jpg"
        alt="Home Canvas Background"
        className="fixed inset-0 h-full w-full object-cover z-0 opacity-80"
      />

      {/* Dark Ambient Vignette Overlay for Readability */}
      <div className={story.overlay} />

      {/* PAGE CONTENT CONTAINER */}
      <div className="relative z-10 mx-auto max-w-[440px] px-5 pt-8">
        {/* TOP BAR */}
        <header className={story.header}>
          <div className={story.identity}>
            <Link href="/you" className={story.portrait}>
              <img
                src={profile.avatarUrl}
                alt={profile.displayName}
                className={story.photo}
              />
            </Link>
            <div className={story.name}>
              <span className="text-[11px] font-bold tracking-widest text-white/80 uppercase">
                {profile.homeArea || 'Singapore'} Cohort
              </span>
              <h1>
                Hey, {profile.displayName}
              </h1>
            </div>
          </div>

          <Link href="/outings/pitch" className={story.pitch}>
              <Plus className="mr-1 h-4 w-4" /> Pitch Outing
          </Link>
        </header>

        {/* EDITORIAL SUMMARY */}
        <section className={story.status}>
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold tracking-widest text-white/80 uppercase">
              Tribal Pass Status
            </span>
            <span className="text-[12px] font-semibold text-white">
              {profile.passCompletionPct}% Complete
            </span>
          </div>

          {(() => {
            const isAnyProvisional = matches.length === 0 || matches.some((m) => m.provisional || (m.confidence !== undefined && m.confidence < 0.55));
            const statusCopy = getTribalPassStatusCopy(profile.passCompletionPct, matches.length, isAnyProvisional);
            return (
              <div className="mt-2 space-y-1">
                <p className="text-[14.5px] font-bold text-white drop-shadow-sm">
                  {statusCopy.headline}
                </p>
                <p className="text-[13.5px] text-white/80 leading-relaxed drop-shadow-sm">
                  {statusCopy.subtitle}
                </p>
              </div>
            );
          })()}

          {/* Dynamic Hairline Data Points */}
          <div className={story.counts}>
            <div><strong className="text-white font-bold">{matches.length}</strong> {matches.length === 1 ? 'Match' : 'Matches'}</div>
            <div><strong className="text-white font-bold">{pitches.length}</strong> Pitched</div>
            <div><strong className="text-white font-bold">{goingOutings.length}</strong> Going</div>
            <div><strong className="text-white font-bold">{radarOutings.length}</strong> On Radar</div>
          </div>
        </section>

        {/* SEGMENTED TAB SWITCHER (Matches | Your Pitches | Going | On your radar) */}
        <section className="mt-5">
          <div className={`${story.navigation} flex border-b border-white/15 overflow-x-auto scrollbar-none gap-2`}>
            <button
              type="button"
              onClick={() => setActiveTab('matches')}
              className={`pb-3 pr-3 text-[13px] font-semibold transition-all whitespace-nowrap ${
                activeTab === 'matches'
                  ? 'text-white border-b-2 border-white font-bold'
                  : 'text-white/60 hover:text-white'
              }`}
            >
              Matches ({matches.length})
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('pitches')}
              className={`px-3 pb-3 text-[13px] font-semibold transition-all whitespace-nowrap ${
                activeTab === 'pitches'
                  ? 'text-white border-b-2 border-white font-bold'
                  : 'text-white/60 hover:text-white'
              }`}
            >
              Your Pitches ({pitches.length})
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('going')}
              className={`px-3 pb-3 text-[13px] font-semibold transition-all whitespace-nowrap ${
                activeTab === 'going'
                  ? 'text-white border-b-2 border-white font-bold'
                  : 'text-white/60 hover:text-white'
              }`}
            >
              Going ({goingOutings.length})
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('radar')}
              className={`px-3 pb-3 text-[13px] font-semibold transition-all text-left leading-tight ${
                activeTab === 'radar'
                  ? 'text-white border-b-2 border-white font-bold'
                  : 'text-white/60 hover:text-white'
              }`}
            >
              On your<br />Radar ({radarOutings.length})
            </button>
          </div>
        </section>

        {/* TAB 1: MATCHES */}
        {activeTab === 'matches' && (
          <section className="mt-6 flex flex-col gap-6">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[11px] font-bold tracking-widest text-white/80 uppercase">
                  Matched Connections
                </span>
                <h3 className="text-[18px] font-bold text-white">
                  People Matched With You
                </h3>
              </div>
              <span className="text-[12px] text-white/70">{matches.length} {matches.length === 1 ? 'Match' : 'Matches'}</span>
            </div>

            {matchListState.kind === 'loading' ? (
              <div className="p-8 text-center rounded-[24px] border border-white/20 bg-black/60 backdrop-blur-xl">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-white border-t-transparent mx-auto" />
                <p className="mt-3 text-[13px] text-white/70">Calculating matches...</p>
              </div>
            ) : matchListState.kind === 'list' ? (
              matches.map((person) => <MatchKeepsake key={person.id} person={person}/>)
            ) : (
              /* Location unavailable, nobody in range, nobody eligible and load
                 failure are four different answers and read as four. */
              <MatchListNotice kind={matchListState.kind} copy={matchListState.copy}
                onRetry={() => setReloadTrigger((prev) => prev + 1)} />
            )}
          </section>
        )}

        {/* TAB 2: YOUR PITCHES */}
        {activeTab === 'pitches' && (
          <section className="mt-6 flex flex-col gap-6">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[11px] font-bold tracking-widest text-white/80 uppercase">
                  Pitched Proposals
                </span>
                <h3 className="text-[18px] font-bold text-white">
                  Pitches You Sent Out
                </h3>
              </div>

              <Link href="/outings/pitch">
                <Button variant="primary" size="sm">
                  <Plus className="mr-1 h-3.5 w-3.5" /> Pitch New
                </Button>
              </Link>
            </div>

            {pitchesError ? (
              <div className="flex flex-col items-center text-center p-8 rounded-[28px] border border-red-500/30 bg-black/70 backdrop-blur-xl shadow-2xl">
                <AlertCircle className="h-10 w-10 text-red-400" />
                <h4 className="mt-4 text-[18px] font-extrabold text-white">Failed to load pitches</h4>
                <p className="mt-2 text-[13px] text-red-200 font-mono bg-red-950/60 p-2 rounded-lg max-w-sm">
                  {pitchesError}
                </p>
                <button
                  type="button"
                  onClick={() => setReloadTrigger((prev) => prev + 1)}
                  className="mt-5 rounded-full bg-white px-5 py-2 text-[13px] font-bold text-black hover:bg-white/90 shadow-md"
                >
                  Try Again
                </button>
              </div>
            ) : pitches.length === 0 ? (
              /* REAL EMPTY STATE FOR YOUR PITCHES */
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex flex-col items-center text-center p-8 rounded-[28px] border border-white/20 bg-black/70 backdrop-blur-xl shadow-2xl"
              >
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white/10 text-white border border-white/20">
                  <Plus className="h-7 w-7" />
                </div>
                <h4 className="mt-4 text-[18px] font-extrabold text-white">You Haven't Pitched Anything Yet</h4>
                <p className="mt-2 text-[13.5px] leading-relaxed text-white/75 max-w-[300px]">
                  Pitch a quiet coffee walk, pottery session, or indie bookshop crawl to gather your cohort.
                </p>
                <Link href="/outings/pitch" className="mt-6">
                  <Button variant="primary" size="sm">
                    <Plus className="mr-1.5 h-4 w-4" /> Pitch Outing
                  </Button>
                </Link>
              </motion.div>
            ) : (
              pitches.map((item) => (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={keepsake.card}
                >
                  {/* Header Badge */}
                  <div className="flex items-center justify-between">
                    <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[11px] font-bold text-white backdrop-blur-md">
                      Your Hosted Pitch
                    </span>
                    <span className="text-[12px] font-bold text-white bg-white/20 px-3 py-1 rounded-full border border-white/30">
                      {item.seatsFilled} / {item.seatsTotal} Seats Filled
                    </span>
                  </div>

                  {/* Event Cover Header */}
                  <OutingCoverHeader
                    cover_image_url={item.cover_image_url}
                    cover_image_thumb_url={item.cover_image_thumb_url}
                    cover_image_alt={item.cover_image_alt || item.title}
                    cover_photographer_name={item.cover_photographer_name}
                    cover_photographer_url={item.cover_photographer_url}
                    title={item.title}
                    category={(item as any).category}
                    area={item.area}
                    className="mt-3"
                  />

                  {/* Title & Pitch */}
                  <h2 className="mt-3 text-[20px] font-extrabold text-white">
                    {item.title}
                  </h2>
                  <p className="mt-1.5 text-[13.5px] text-white/90 leading-relaxed">
                    “{item.pitch}”
                  </p>

                  {/* Area, Time & Cohesion Readout */}
                  <div className="mt-4 flex items-center justify-between border-t border-b border-white/15 py-3 text-[12.5px] text-white/80">
                    <div className="flex items-center gap-1.5">
                      <MapPin className="h-3.5 w-3.5 text-white" />
                      <span>{item.area}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Calendar className="h-3.5 w-3.5 text-white" />
                      <span>{item.dateTime}</span>
                    </div>
                    <div className="flex items-center gap-1 text-white font-bold">
                      <Sparkles className="h-3.5 w-3.5 text-white" />
                      <span>{item.cohesionScore}/100 Cohesion</span>
                    </div>
                  </div>

                  {/* WHO JOINED / GUEST ROSTER */}
                  <div className="mt-4">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold tracking-widest text-white/80 uppercase">
                        Who Joined ({(item.joinedGuests?.length || 0) + 1} Members)
                      </span>
                      <span className="text-[11.5px] text-white/70">
                        Cap: 6 Seats Max
                      </span>
                    </div>

                    {/* Joined Guests List */}
                    <div className="mt-3 flex flex-col gap-2.5">
                      {/* Host item */}
                      <div className="flex items-center justify-between rounded-[16px] border border-white/20 bg-white/10 p-2.5">
                        <div className="flex items-center gap-3">
                          <img
                            src={item.hostAvatar}
                            alt={item.hostName}
                            className="h-8 w-8 rounded-full object-cover ring-1 ring-white/30 shrink-0"
                          />
                          <div>
                            <span className="text-[13px] font-bold text-white block">
                              {item.hostName} (You)
                            </span>
                            <span className="text-[11px] text-white/70 block">Host</span>
                          </div>
                        </div>
                        <span className="rounded-full bg-emerald-400/20 text-emerald-300 border border-emerald-400/40 px-2.5 py-0.5 text-[10px] font-bold">
                          Host
                        </span>
                      </div>

                      {item.joinedGuests?.map((guest) => (
                        <div
                          key={guest.id || guest.name}
                          className="flex items-center justify-between rounded-[16px] border border-white/15 bg-white/5 p-2.5"
                        >
                          <div className="flex items-center gap-3">
                            <img
                              src={guest.avatarUrl}
                              alt={guest.name}
                              className="h-8 w-8 rounded-full object-cover ring-1 ring-white/20 shrink-0"
                            />
                            <div>
                              <span className="text-[13px] font-bold text-white block">
                                {guest.name}
                              </span>
                              <span className="text-[11px] text-white/70 block">
                                {guest.homeArea || 'Singapore'}
                              </span>
                            </div>
                          </div>
                          <span
                            className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold border ${
                              guest.status === 'Confirmed'
                                ? 'bg-emerald-400/20 text-emerald-300 border-emerald-400/40'
                                : 'bg-amber-400/20 text-amber-300 border-amber-400/40'
                            }`}
                          >
                            {guest.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Pitch Host Controls */}
                  <div className="mt-4 flex items-center justify-between gap-2 pt-3 border-t border-white/15">
                    <div className="flex items-center gap-2">
                      <Link href={`/outings/${item.id}?edit=true`}>
                        <Button variant="ghost" size="sm" className="whitespace-nowrap text-amber-300 border border-amber-400/30 bg-amber-500/10 hover:bg-amber-500/20 text-[11.5px] px-2.5">
                          <Edit3 className="mr-1 h-3.5 w-3.5" /> Edit Pitch
                        </Button>
                      </Link>

                      <Button
                        variant="ghost"
                        size="sm"
                        className="whitespace-nowrap text-red-300 border border-red-400/30 bg-red-500/10 hover:bg-red-500/20 text-[11.5px] px-2.5"
                        onClick={() => handleDeletePitch(item.id)}
                      >
                        <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete
                      </Button>
                    </div>

                    <Link href={`/outings/${item.id}`}>
                      <Button variant="secondary" size="sm" className="whitespace-nowrap text-[11.5px] px-3">
                        View Outing →
                      </Button>
                    </Link>
                  </div>
                </motion.div>
              ))
            )}
          </section>
        )}

        {/* TAB 3: GOING (ACCEPTED OUTINGS) */}
        {activeTab === 'going' && (
          <section className="mt-6 flex flex-col gap-5">
            <div>
              <span className="text-[11px] font-bold tracking-widest text-white/80 uppercase">
                Upcoming Outings
              </span>
              <h3 className="text-[18px] font-bold text-white leading-tight">
                Outings You're<br />Attending
              </h3>
              <p className="mt-1 text-[13px] text-white/70">
                Outings where your seat is confirmed & accepted.
              </p>
            </div>

            {goingError ? (
              <div className="flex flex-col items-center text-center p-8 rounded-[28px] border border-red-500/30 bg-black/70 backdrop-blur-xl shadow-2xl">
                <AlertCircle className="h-10 w-10 text-red-400" />
                <h4 className="mt-4 text-[18px] font-extrabold text-white">Failed to load attending outings</h4>
                <p className="mt-2 text-[13px] text-red-200 font-mono bg-red-950/60 p-2 rounded-lg max-w-sm">
                  {goingError}
                </p>
                <button
                  type="button"
                  onClick={() => setReloadTrigger((prev) => prev + 1)}
                  className="mt-5 rounded-full bg-white px-5 py-2 text-[13px] font-bold text-black hover:bg-white/90 shadow-md"
                >
                  Try Again
                </button>
              </div>
            ) : goingOutings.length === 0 ? (
              /* REAL EMPTY STATE FOR GOING */
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex flex-col items-center text-center p-8 rounded-[28px] border border-white/20 bg-black/70 backdrop-blur-xl shadow-2xl"
              >
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white/10 text-white border border-white/20">
                  <Users className="h-7 w-7" />
                </div>
                <h4 className="mt-4 text-[18px] font-extrabold text-white">No Upcoming Outings Yet</h4>
                <p className="mt-2 text-[13.5px] leading-relaxed text-white/75 max-w-[300px]">
                  When you join a pitched outing or accept an invite, your confirmed meetups will appear here.
                </p>
                <button
                  type="button"
                  onClick={() => setActiveTab('radar')}
                  className="mt-6 text-[13px] font-bold text-amber-300 hover:underline"
                >
                  Explore On Your Radar →
                </button>
              </motion.div>
            ) : (
              goingOutings.map((item, idx) => (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.05 }}
                  className={keepsake.card}
                >
                  <div className="flex items-center justify-between">
                    <span className="rounded-full border border-emerald-400/40 bg-emerald-500/20 px-3 py-1 text-[11px] font-bold text-emerald-300 backdrop-blur-md">
                      ✓ Confirmed Seat
                    </span>
                    <span className="text-[11.5px] font-bold text-white/70">
                      {item.seatsFilled} / {item.seatsTotal} Seats
                    </span>
                  </div>

                  {/* Event Cover Header */}
                  <OutingCoverHeader
                    cover_image_url={item.cover_image_url}
                    cover_image_thumb_url={item.cover_image_thumb_url}
                    cover_image_alt={item.cover_image_alt || item.title}
                    cover_photographer_name={item.cover_photographer_name}
                    cover_photographer_url={item.cover_photographer_url}
                    title={item.title}
                    category={item.category}
                    area={item.area}
                    className="mt-3"
                  />

                  <div>
                    <h3 className="text-[19px] font-extrabold text-white">
                      {item.title}
                    </h3>
                    <p className="mt-1.5 text-[13.5px] text-white/90 leading-relaxed">
                      “{item.pitch}”
                    </p>
                  </div>

                  <div className="flex items-center justify-between border-t border-b border-white/15 py-3 text-[12.5px] text-white/80">
                    <div className="flex items-center gap-1.5">
                      <MapPin className="h-3.5 w-3.5 text-white" />
                      <span>{item.area}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Calendar className="h-3.5 w-3.5 text-white" />
                      <span>{item.dateTime}</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-3 pt-2 border-t border-white/15">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <img
                        src={item.hostAvatar}
                        alt={item.hostName}
                        className="h-8 w-8 rounded-full object-cover ring-1 ring-white/30 shrink-0"
                      />
                      <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                        <span className="text-[12px] text-white/80 whitespace-nowrap">Pitched by</span>
                        <span className="text-[12.5px] font-bold text-white whitespace-nowrap">{item.hostName}</span>
                      </div>
                    </div>

                    <Link href={`/outings/${item.id}`} className="shrink-0">
                      <Button variant="secondary" size="sm" className="whitespace-nowrap">
                        View Record →
                      </Button>
                    </Link>
                  </div>
                </motion.div>
              ))
            )}
          </section>
        )}

        {/* TAB 4: ON YOUR RADAR */}
        {activeTab === 'radar' && (
          <section className="mt-6 flex flex-col gap-5">
            <div>
              <span className="text-[11px] font-bold tracking-widest text-white/80 uppercase">
                Curated Recommendations
              </span>
              <h3 className="text-[18px] font-bold text-white leading-tight">
                On your<br />Radar
              </h3>
              <p className="mt-1 text-[13px] text-white/70">
                Suggested pitches and events suited to your social rhythm & interests.
              </p>
            </div>

            {radarError ? (
              <div className="flex flex-col items-center text-center p-8 rounded-[28px] border border-red-500/30 bg-black/70 backdrop-blur-xl shadow-2xl">
                <AlertCircle className="h-10 w-10 text-red-400" />
                <h4 className="mt-4 text-[18px] font-extrabold text-white">Failed to load radar outings</h4>
                <p className="mt-2 text-[13px] text-red-200 font-mono bg-red-950/60 p-2 rounded-lg max-w-sm">
                  {radarError}
                </p>
                <button
                  type="button"
                  onClick={() => setReloadTrigger((prev) => prev + 1)}
                  className="mt-5 rounded-full bg-white px-5 py-2 text-[13px] font-bold text-black hover:bg-white/90 shadow-md"
                >
                  Try Again
                </button>
              </div>
            ) : radarOutings.length === 0 ? (
              /* REAL HONEST EMPTY STATE FOR RADAR */
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex flex-col items-center text-center p-8 rounded-[28px] border border-white/20 bg-black/70 backdrop-blur-xl shadow-2xl"
              >
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white/10 text-white border border-white/20">
                  <Compass className="h-7 w-7" />
                </div>
                <h4 className="mt-4 text-[18px] font-extrabold text-white">No Outings On Your Radar Yet</h4>
                <p className="mt-2 text-[13.5px] leading-relaxed text-white/75 max-w-[300px]">
                  New outings pitched by members in Singapore will appear here when posted.
                </p>
                <Link href="/outings/pitch" className="mt-6">
                  <Button variant="primary" size="sm">
                    <Plus className="mr-1.5 h-4 w-4" /> Pitch Outing
                  </Button>
                </Link>
              </motion.div>
            ) : (
              radarOutings.map((item, idx) => (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.05 }}
                  className={keepsake.card}
                >
                  <div className="flex items-center justify-between">
                    {item.fitBadge ? (
                      <span className="rounded-full border border-amber-400/40 bg-amber-500/20 px-3 py-1 text-[11px] font-bold text-amber-300 backdrop-blur-md flex items-center gap-1">
                        <Sparkles className="h-3.5 w-3.5" /> {item.fitBadge}
                      </span>
                    ) : (
                      <span className="text-[11px] font-bold tracking-widest text-white/60 uppercase">
                        {item.area} · {item.category || 'Outing'}
                      </span>
                    )}
                    <span className="text-[11.5px] font-bold text-white/70">
                      {item.seatsFilled} / {item.seatsTotal} Seats
                    </span>
                  </div>

                  {/* Event Cover Header */}
                  <OutingCoverHeader
                    cover_image_url={item.cover_image_url}
                    cover_image_thumb_url={item.cover_image_thumb_url}
                    cover_image_alt={item.cover_image_alt || item.title}
                    cover_photographer_name={item.cover_photographer_name}
                    cover_photographer_url={item.cover_photographer_url}
                    title={item.title}
                    category={item.category}
                    area={item.area}
                    className="mt-3"
                  />

                  <div>
                    <h3 className="text-[19px] font-extrabold text-white">
                      {item.title}
                    </h3>
                    <p className="mt-1.5 text-[13.5px] text-white/90 leading-relaxed">
                      “{item.pitch}”
                    </p>
                  </div>

                  <div className="flex items-center justify-between border-t border-b border-white/15 py-3 text-[12.5px] text-white/80">
                    <div className="flex items-center gap-1.5">
                      <MapPin className="h-3.5 w-3.5 text-white" />
                      <span>{item.area}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Calendar className="h-3.5 w-3.5 text-white" />
                      <span>{item.dateTime}</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-3 pt-2 border-t border-white/15">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <img
                        src={item.hostAvatar}
                        alt={item.hostName}
                        className="h-8 w-8 rounded-full object-cover ring-1 ring-white/30 shrink-0"
                      />
                      <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                        <span className="text-[12px] text-white/80 whitespace-nowrap">Pitched by</span>
                        <span className="text-[12.5px] font-bold text-white whitespace-nowrap">{item.hostName}</span>
                        {Boolean(item.isHostDemo) && (
                          <span className="rounded-full bg-amber-400 text-black px-2 py-0.5 text-[9.5px] font-extrabold uppercase shrink-0 whitespace-nowrap">
                            Demo
                          </span>
                        )}
                      </div>
                    </div>

                    <Button
                      variant={radarJoined[item.id] ? 'secondary' : 'primary'}
                      size="sm"
                      className="whitespace-nowrap shrink-0"
                      onClick={() => handleToggleRadarJoin(item.id)}
                    >
                      {radarJoined[item.id] ? 'Joined ✓' : 'Join Pitch →'}
                    </Button>
                  </div>
                </motion.div>
              ))
            )}
          </section>
        )}
      </div>
    </div>
  );
}
