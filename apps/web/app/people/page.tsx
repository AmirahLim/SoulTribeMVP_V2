'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {MatchKeepsake} from '../../components/MatchKeepsake';
import { getUserProfile } from '../../lib/userStore';
import { getLastSpatialPoolSize, getRankedMatches, RankedMatch, countRealMembers, isSmallCommunityMode } from '../../lib/matching';
import { MapPin, ArrowRight, AlertCircle, Sparkles, Users } from 'lucide-react';
import { motion } from 'framer-motion';

import { AuthGuard } from '../../components/AuthGuard';
import { useAuth } from '../../lib/authContext';

export default function PeopleListPage() {
  return (
    <AuthGuard>
      <PeopleListContent />
    </AuthGuard>
  );
}

function PeopleListContent() {
  const { user: authUser } = useAuth();
  const [city, setCity] = useState('Singapore');
  const [matches, setMatches] = useState<RankedMatch[]>([]);
  const [realMemberCount, setRealMemberCount] = useState<number>(0);
  const [isSmallCommunity, setIsSmallCommunity] = useState<boolean>(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nearbyEmpty, setNearbyEmpty] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const userProf = getUserProfile();
        const effectiveCity = userProf.homeArea || city;
        if (userProf.homeArea) setCity(userProf.homeArea);

        const effectiveUser = {
          ...userProf,
          id: authUser?.id || userProf.id,
        };

        const realCount = await countRealMembers(effectiveCity);
        const isSmall = isSmallCommunityMode(realCount);

        const ranked = await getRankedMatches(effectiveUser, { userId: authUser?.id, area: effectiveCity, discovery: 'community' });
        if (cancelled) return;

        setRealMemberCount(realCount);
        setIsSmallCommunity(isSmall);
        setMatches(ranked);
        setNearbyEmpty(ranked.length === 0 && getLastSpatialPoolSize() === 0);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        console.error('Failed to calculate matches:', err);
        setError('Unable to load matches right now. Please try refreshing.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authUser?.id, city]);

  return (
    <div className="relative min-h-screen w-full bg-black text-[#FFFDF9] pb-24">
      {/* PAGE CANVAS BACKGROUND */}
      <img
        src="/user-artsy-1.jpg"
        alt="Artsy Golden Hour Motion Canvas"
        className="fixed inset-0 h-full w-full object-cover z-0 opacity-80"
      />

      {/* Dark Ambient Vignette Overlay */}
      <div className="fixed inset-0 bg-gradient-to-b from-black/70 via-black/40 to-black/95 z-0 pointer-events-none" />

      {/* PAGE CONTENT CONTAINER */}
      <div className="relative z-10 mx-auto max-w-[440px] px-5 pt-8">
        {/* EDITORIAL HEADER: THIS WEEK'S PEOPLE */}
        <header className="pb-6 border-b border-white/15">
          <span className="text-[11px] font-bold tracking-widest text-white/80 uppercase">
            Curated Batch · {city}
          </span>
          <h1 className="mt-1 text-[28px] font-extrabold tracking-tight text-white drop-shadow-md">
            This Week's People
          </h1>
          <p className="mt-1.5 text-[14px] text-white/90 leading-relaxed max-w-[340px] drop-shadow-sm">
            Surfaced based on your Friendship DNA and {city} rhythm. No swiping.
          </p>
        </header>

        {/* SMALL COMMUNITY HONEST BANNER */}
        {!loading && !error && isSmallCommunity && (
          <motion.div
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-6 rounded-[20px] border border-amber-400/40 bg-amber-500/15 p-4 sm:p-5 text-[13px] text-amber-200 backdrop-blur-md shadow-xl flex items-start gap-3.5 overflow-hidden"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-400/20 border border-amber-400/30 text-amber-300 shrink-0 mt-0.5 shadow-sm">
              <Users className="h-4.5 w-4.5" />
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="font-extrabold text-amber-300 uppercase tracking-wider text-[11px] leading-tight">
                Small Community Mode
              </h4>
              <p className="mt-1 text-amber-100/90 leading-relaxed text-[13px]">
                You're one of the first {realMemberCount} members in {city}. Matching sharpens as more people join - for now, here's everyone nearby.
              </p>
            </div>
          </motion.div>
        )}

        {/* LOADING STATE */}
        {loading && (
          <div className="mt-12 flex flex-col items-center justify-center p-8 rounded-[24px] border border-white/15 bg-black/60 backdrop-blur-xl">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-white border-t-transparent" />
            <p className="mt-4 text-[14px] font-medium text-white/80">Calculating Friendship DNA Resonance...</p>
          </div>
        )}

        {/* ERROR STATE */}
        {!loading && error && (
          <div className="mt-12 flex flex-col items-center text-center p-8 rounded-[24px] border border-red-500/30 bg-black/70 backdrop-blur-xl">
            <AlertCircle className="h-10 w-10 text-red-400" />
            <h3 className="mt-3 text-[18px] font-bold text-white">Match Calculation Error</h3>
            <p className="mt-1.5 text-[13.5px] text-white/80 leading-relaxed">{error}</p>
          </div>
        )}

        {/* EMPTY STATE */}
        {!loading && !error && matches.length === 0 && (
          <div className="mt-12 flex flex-col items-center text-center p-8 rounded-[28px] border border-white/20 bg-black/70 backdrop-blur-xl shadow-2xl">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white/10 text-[24px] border border-white/20">
              ✨
            </div>
            <h3 className="mt-4 text-[20px] font-extrabold text-white">
              {nearbyEmpty ? 'Nobody nearby is online' : 'No matches yet'}
            </h3>
            <p className="mt-2 text-[14px] leading-relaxed text-white/80 max-w-[300px]">
              {nearbyEmpty
                ? 'Matching looks first at people who are currently online within your travel distance. Check location permission, or try again when someone nearby is around.'
                : 'No eligible connections were returned this time. Your saved answers are still here; you can review your preferences or check back later.'}
            </p>
            <Link href="/you/deeper" className="mt-6">
              <span className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-[13.5px] font-bold text-black shadow-lg transition-transform hover:scale-105">
                <Sparkles className="h-4 w-4" /> Deepen Your Pass
              </span>
            </Link>
          </div>
        )}

        {/* CURATED MATCHES BATCH LISTING */}
        {!loading && !error && matches.length > 0 && (
          <div className="mt-6 flex flex-col gap-6">
            {matches.map(person => <MatchKeepsake key={person.id} person={person}/>)}
          </div>
        )}
      </div>
    </div>
  );
}
