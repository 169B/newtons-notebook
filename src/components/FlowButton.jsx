import { ArrowRight, ArrowLeft } from 'lucide-react'
import './FlowButton.css'

/**
 * Flow-style pill button (adapted from FlowButton for this CSS/Vite app —
 * no Tailwind/shadcn required).
 */
export function FlowButton({
  text = 'Modern Button',
  onClick,
  direction = 'next',
  disabled = false,
  type = 'button',
}) {
  const Arrow = direction === 'prev' ? ArrowLeft : ArrowRight

  return (
    <button
      type={type}
      className={`flow-btn flow-btn--${direction}`}
      onClick={onClick}
      disabled={disabled}
    >
      <Arrow className="flow-btn__arr flow-btn__arr--in" aria-hidden />
      <span className="flow-btn__text">{text}</span>
      <span className="flow-btn__circle" aria-hidden />
      <Arrow className="flow-btn__arr flow-btn__arr--out" aria-hidden />
    </button>
  )
}
