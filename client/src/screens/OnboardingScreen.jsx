/** ✦ FLOWRA — Onboarding Screen */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useAuthStore from '../stores/authStore';
import { profile } from '../services/api';
import './OnboardingScreen.css';

const slides = [
  {
    title: "Your mind, unloaded.",
    text: "Don't categorize. Just dump your thoughts, tasks, and ideas into the capture field. Our engine extracts the actionable bits automatically.",
    icon: "🧠"
  },
  {
    title: "Always know what's next.",
    text: "Flowra calculates priority using deadlines, staleness, and blockages to build your Today view. No more manual sorting.",
    icon: "⚡"
  },
  {
    title: "Total Recall.",
    text: "Ask questions like 'What did I decide about the Q3 budget?' and get instant answers sourced from your past entries.",
    icon: "🔍"
  }
];

export default function OnboardingScreen() {
  const [currentSlide, setCurrentSlide] = useState(0);
  const [completing, setCompleting] = useState(false);
  const navigate = useNavigate();
  const { init } = useAuthStore();

  const handleNext = async () => {
    if (currentSlide < slides.length - 1) {
      setCurrentSlide(s => s + 1);
    } else {
      setCompleting(true);
      try {
        await profile.update({ onboarded: true });
        await init(); // Refresh user state from server
        navigate('/', { replace: true });
      } catch (err) {
        console.error(err);
        setCompleting(false);
      }
    }
  };

  return (
    <div className="onboard-bg">
      <div className="onboard-card glass animate-scaleIn">
        <div className="onboard-icon">{slides[currentSlide].icon}</div>
        <h1 className="onboard-title">{slides[currentSlide].title}</h1>
        <p className="onboard-text">{slides[currentSlide].text}</p>
        
        <div className="onboard-dots">
          {slides.map((_, i) => (
            <div key={i} className={`onboard-dot ${i === currentSlide ? 'active' : ''}`} />
          ))}
        </div>

        <button 
          className="btn btn-primary btn-lg onboard-btn" 
          onClick={handleNext}
          disabled={completing}
        >
          {completing ? <span className="spinner" /> : currentSlide === slides.length - 1 ? "Enter Flowra" : "Next"}
        </button>
      </div>
    </div>
  );
}
