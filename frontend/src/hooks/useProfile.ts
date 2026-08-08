'use client'

import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = 'autopilot.profile'
const PROFILE_EVENT = 'autopilot-profile-updated'

export type UserProfile = { name: string; email: string }

export function useProfile(fallback?: Partial<UserProfile>) {
  const defaultName = fallback?.name || 'Administrator'
  const defaultEmail = fallback?.email || 'admin@autopilot.local'
  const defaults: UserProfile = { name: defaultName, email: defaultEmail }
  const [profile, setProfileState] = useState<UserProfile>(defaults)

  const load = useCallback(() => {
    const fallbackProfile = { name: defaultName, email: defaultEmail }
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) setProfileState({ ...fallbackProfile, ...JSON.parse(saved) })
      else setProfileState(fallbackProfile)
    } catch { setProfileState(fallbackProfile) }
  }, [defaultName, defaultEmail])

  useEffect(() => {
    load()
    window.addEventListener(PROFILE_EVENT, load)
    return () => window.removeEventListener(PROFILE_EVENT, load)
  }, [load])

  const saveProfile = useCallback((next: UserProfile) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    setProfileState(next)
    window.dispatchEvent(new Event(PROFILE_EVENT))
  }, [])

  return { profile, saveProfile }
}
