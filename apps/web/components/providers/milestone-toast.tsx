'use client'

import { useEffect, useRef } from 'react'
import { useToast } from './toast-provider'

interface MilestoneToastProps {
  message: string
  fireKey: string
}

export function MilestoneToast({ message, fireKey }: MilestoneToastProps) {
  const { toast } = useToast()
  const fired = useRef<string | null>(null)

  useEffect(() => {
    if (fired.current === fireKey) return
    fired.current = fireKey
    toast(message, 'success')
  }, [fireKey, message, toast])

  return null
}
