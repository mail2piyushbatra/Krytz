/** ✦ Krytz — Onboarding Screen (v3: premium animated experience) */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useAuthStore from '../stores/authStore';
import { profile } from '../services/api';
import { ActionBtn } from '../components/ui/UiKit';
import { Brain, Zap, Search, ArrowRight, Sparkles } from 'lucide-react';
import './OnboardingScreen.css';

const slides = [
  {
    title: "Your mind, unloaded.",
    text: "Don't categorize. Just dump your thoughts, tasks, and ideas into the capture field. Our engine extracts the actionable bits automatically.",
    Icon: Brain,
    accent: 'var(--accent-primary)',
  },
  {
    title: "Always know what's next.",
    text: "Krytz calculates priority using deadlines, staleness, and blockages to build your operating state. No more manual sorting.",
    Icon: Zap,
    accent: '#6c5ce7',
  },
  {
    title: "Total Recall.",
    text: "Ask questions like 'What did I decide about the Q3 budget?' and get instant answers sourced from your past entries.",
    Icon: Search,
    accent: '#00b894',
  }
];

export default function OnboardingScreen() {
  const [currentSlide, setCurrentSlide] = useState(0);
  const navigate = useNavigate();
  const { init } = useAuthStore();

  const handleNext = async () => {
    if (currentSlide < slides.length - 1) {
      setCurrentSlide(s => s + 1);
    } else {
      await profile.update({ onboarded: true });
      await init();
      navigate('/', { replace: true });
    }
  };

  const slide = slides[currentSlide];
  const SlideIcon = slide.Icon;

  return (
    <div className="onboard-bg">
      {/* Animated background orbs */}
      <div className="onboard-orb onboard-orb-1" />
      <div className="onboard-orb onboard-orb-2" />
      <div className="onboard-orb onboard-orb-3" />

      <div className="onboard-card glass animate-scaleIn" key={currentSlide}>
        <div className="onboard-sparkle">
          <Sparkles size={14} />
        </div>

        <div className="onboard-icon-ring" style={{ '--slide-accent': slide.accent }}>
          <SlideIcon size={36} className="onboard-icon" />
        </div>

        <h1 className="onboard-title">{slide.title}</h1>
        <p className="onboard-text">{slide.text}</p>
        
        {/* Progress dots */}
        <div className="onboard-dots">
          {slides.map((_, i) => (
            <button
              key={i}
              className={`onboard-dot ${i === currentSlide ? 'active' : ''} ${i < currentSlide ? 'completed' : ''}`}
              onClick={() => setCurrentSlide(i)}
            />
          ))}
        </div>

        <ActionBtn 
          variant="primary"
          className="onboard-btn"
          onClick={handleNext}
          icon={currentSlide === slides.length - 1 ? Sparkles : ArrowRight}
        >
          {currentSlide === slides.length - 1 ? "Enter Krytz" : "Next"}
        </ActionBtn>

        {currentSlide > 0 && (
          <button 
            className="onboard-back" 
            onClick={() => setCurrentSlide(s => s - 1)}
          >
            Back
          </button>
        )}
      </div>
    </div>
  );
}
