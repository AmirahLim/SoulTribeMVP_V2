'use client';
import {SocialScrapbook} from '../../../components/profile/SocialScrapbook';
import {PeerReadPanel} from '../../../components/profile/PeerReadPanel';
import {selfSocialPages, sharedChoices} from '../../../lib/socialScrapbook';
import type {ComposedRead} from '../../../lib/readEngine/compose';
import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { AuthGuard } from '../../../components/AuthGuard';
import { useAuth } from '../../../lib/authContext';
import { getSupabaseBrowserClient } from '../../../lib/supabase';
import { SafetyActions } from '../../../components/outings/SafetyActions';

type PublicProfile = {
  id: string;
  display_name: string;
  handle: string;
  avatar_url?: string;
  bio?: string;
  life_contexts?: string[];
  public_onboarding?: Record<string,unknown>;
  home_area?: string;
  user_values?: { value_key: string }[];
};
export default function PersonDetailPage() {
  return (
    <AuthGuard>
      <PersonDetailContent />
    </AuthGuard>
  );
}
function PersonDetailContent() {
  const { id } = useParams<{ id: string }>();
  const { user,session } = useAuth();
  const [read,setRead]=useState<ComposedRead|null>(null),[readError,setReadError]=useState('');
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [status, setStatus] = useState('Loading profile…');
  const [attempt, setAttempt] = useState(0);
  useEffect(()=>{
    const controller=new AbortController();setRead(null);setReadError('');
    if(!session?.access_token)return;
    fetch(`/api/profile/read?id=${encodeURIComponent(id)}`,{headers:{Authorization:`Bearer ${session.access_token}`},signal:controller.signal})
      .then(async r=>{const body=await r.json();if(!r.ok)throw new Error(body.error||'Unable to load this reading');return body;})
      .then(body=>setRead(body.composedRead)).catch(e=>{if(e.name!=='AbortError')setReadError('The profile reading could not be loaded. Please try again.');});
    return()=>controller.abort();
  },[id,attempt,session?.access_token]);
  const [pitches, setPitches] = useState<
    { id: string; title: string; area: string }[]
  >([]);
  useEffect(() => {
    let active = true;
    setProfile(null);
    setPitches([]);
    setStatus('Loading profile…');
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        id,
      )
    ) {
      setStatus('Profile unavailable.');
      return;
    }
    // Explicit public projection, governed by bilateral block/status RLS.
    getSupabaseBrowserClient()
      .from('profiles')
      .select(
        'id,display_name,handle,avatar_url,bio,home_area,life_contexts,public_onboarding,user_values(value_key)',
      )
      .eq('id', id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active) return;
        if (error) setStatus('Unable to load this profile.');
        else if (!data) setStatus('Profile unavailable.');
        else {
          setProfile(data as PublicProfile);
          setStatus('');
        }
      });
    getSupabaseBrowserClient()
      .from('active_pitches')
      .select('id,title,area')
      .eq('host_id', id)
      .order('starts_at')
      .limit(6)
      .then(({ data }) => {
        if (active) setPitches(data || []);
      });
    return () => {
      active = false;
    };
  }, [id, attempt]);
  const sharedIntent = sharedChoices(profile?.public_onboarding, 'intent', 'intentOther');
  const sharedSettings = sharedChoices(profile?.public_onboarding, 'groupChoices');
  const sharedSummary = [
    sharedIntent.length ? `Looking for: ${sharedIntent.join(' · ')}.` : '',
    sharedSettings.length ? `Feels most at home in: ${sharedSettings.join(' · ')}.` : '',
  ].filter(Boolean).join(' ');
  return (
    <div>
      {!profile && <div className="min-h-screen bg-[#192c23] text-[#f3ecdc] p-8">
        <Link href="/people" className="underline">Back to people</Link>
        <div role="status" className="mt-8"><p>{status}</p><button className="py-3 underline" onClick={() => setAttempt(n => n + 1)}>Try again</button></div>
      </div>}
      {profile && <SocialScrapbook name={profile.display_name} handle={profile.handle} area={profile.home_area}
        avatar={profile.avatar_url} bio={profile.bio} headline={read?.sections[0]?.title} summary={read?.sections[0]?.text}
        earlyReadHref={`/people/${profile.id}/early-read`}
        pages={read?selfSocialPages({composedRead:read,threads:[],values:[],interests:[]}).map(page=>({...page,href:`/people/${profile.id}/bond`,action:'Explore your connection →'})):[]}>
        {readError&&<p role="alert">{readError}<button className="underline p-2" onClick={()=>setAttempt(n=>n+1)}>Try again</button></p>}
        {!read&&!readError&&<p role="status">Reading what they shared…</p>}
        {read&&!read.sections.length&&<p>No supported profile pages are available from the answers shared so far.</p>}
        <div className="flex flex-wrap gap-5 mb-8">
          <Link href={`/people/${profile.id}/bond`} className="inline-flex items-center justify-center rounded-sm bg-[#eee5d2] text-[#303c2b] border border-[#d4c7aa] px-5 py-3 min-h-[46px] hover:bg-[#e0d3b8]">View Connection →</Link>
          <Link href={`/outings/pitch?inviteId=${profile.id}`} className="underline py-3">Invite them to an outing →</Link>
        </div>
        {!!profile.life_contexts?.length && <p className="mb-6">Life lately · {profile.life_contexts.join(' · ')}</p>}
        {!!pitches.length && <section className="mb-8"><h2 className="font-serif text-2xl">Their open Pitches</h2>
          {pitches.map(p => <Link className="block py-4 border-b border-white/20" key={p.id} href={`/outings/${p.id}`}>{p.title} · {p.area} ↗</Link>)}
        </section>}
        <Link href="/people" className="inline-block underline py-3 mb-5">Back to people</Link>
        {user && <SafetyActions userId={user.id} targetId={profile.id}/>}
        <PeerReadPanel subjectId={profile.id}/>
      </SocialScrapbook>}
    </div>
  );
}
