// DJ Stemy, the face of Stemma's assistant: the Stemma logo (grey root, orange fork, green fork) wearing big
// cartoon eyes and DJ headphones. No head: just eyes and headphones on the logo.
//   mood "idle"      floats, blinks and looks around
//   mood "thinking"  nods to the beat, headphones thump, notes float out (while it digs through the library)
//   mood "talking"   a little bounce when it answers
// Animations live in stemy.css and stop with prefers-reduced-motion.
import { useId } from 'react'
import './stemy.css'

export function DJStemy({ size = 40, mood = 'idle', className = '' }) {
  const id = useId().replace(/:/g, '')
  // Each Stemy blinks on its own schedule, so a chat full of them does not blink in sync.
  const delay = -((id.split('').reduce((h, c) => h * 31 + c.charCodeAt(0), 7) >>> 0) % 40) / 10
  return (
    <svg
      className={`stemy ${mood} ${className}`}
      width={size}
      height={size * 1.125}
      viewBox="0 0 64 72"
      style={{ '--stemy-delay': `${delay}s` }}
      aria-hidden="true"
    >
      <defs>
        <radialGradient id={`eye-${id}`} cx="45%" cy="35%" r="70%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="70%" stopColor="#f2f3f5" />
          <stop offset="100%" stopColor="#c9ced4" />
        </radialGradient>
      </defs>
      <g className="stemy-body">
        {/* The Stemma logo, scaled up: the body. */}
        <g transform="translate(11 34) scale(2.1)">
          <path d="M5 3v8a4 4 0 0 0 4 4h2M5 11a4 4 0 0 1 4-4h4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <circle cx="5" cy="3" r="2" fill="currentColor" />
          <circle cx="15" cy="7" r="2.5" fill="var(--orange)" />
          <circle cx="13" cy="15" r="2.5" fill="var(--note)" />
        </g>

        {/* DJ headphones: band over the eyes, a cup on each side. */}
        <g className="stemy-phones">
          <path d="M11 30C11 5 53 5 53 30" fill="none" stroke="#4b565d" strokeWidth="5" strokeLinecap="round" />
          <path d="M15.5 19C19 9.5 45 9.5 48.5 19" fill="none" stroke="#ffffff" strokeOpacity="0.3" strokeWidth="1.3" strokeLinecap="round" />
          <g className="stemy-cup">
            <rect x="4" y="21" width="12" height="18" rx="4.5" fill="#4b565d" />
            <rect x="6.5" y="24.5" width="5.5" height="11" rx="2.75" fill="var(--orange)" />
            <rect x="13.5" y="23" width="4" height="14" rx="2" fill="#22282c" />
          </g>
          <g className="stemy-cup">
            <rect x="48" y="21" width="12" height="18" rx="4.5" fill="#4b565d" />
            <rect x="52" y="24.5" width="5.5" height="11" rx="2.75" fill="var(--orange)" />
            <rect x="46.5" y="23" width="4" height="14" rx="2" fill="#22282c" />
          </g>
          <text className="stemy-note n1" x="2" y="18">
            ♪
          </text>
          <text className="stemy-note n2" x="56" y="16">
            ♫
          </text>
          <text className="stemy-note n3" x="58" y="22">
            ♪
          </text>
        </g>

        {/* Eyes like the 👀 emoji: white ovals, dark pupils with a shine. */}
        <g className="stemy-eye">
          <ellipse cx="25.5" cy="29" rx="6.8" ry="8.6" fill={`url(#eye-${id})`} stroke="#1f2427" strokeWidth="1.2" />
        </g>
        <g className="stemy-eye">
          <ellipse cx="38.5" cy="29" rx="6.8" ry="8.6" fill={`url(#eye-${id})`} stroke="#1f2427" strokeWidth="1.2" />
        </g>
        <g className="stemy-pupils">
          <g className="stemy-eye">
            <ellipse cx="23.8" cy="30" rx="3.2" ry="4.1" fill="#1b1d21" />
            <circle cx="22.7" cy="28.4" r="1.05" fill="#ffffff" />
          </g>
          <g className="stemy-eye">
            <ellipse cx="36.8" cy="30" rx="3.2" ry="4.1" fill="#1b1d21" />
            <circle cx="35.7" cy="28.4" r="1.05" fill="#ffffff" />
          </g>
        </g>
      </g>
    </svg>
  )
}
