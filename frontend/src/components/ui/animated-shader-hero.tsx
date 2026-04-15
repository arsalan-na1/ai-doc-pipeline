import React from 'react';
import { ShaderAnimation } from './shader-animation';

interface HeroProps {
  trustBadge?: {
    text: string;
    icons?: string[];
  };
  headline: {
    line1: string;
    line2: string;
  };
  headlineNode?: React.ReactNode;
  subtitle: string;
  subtitleNode?: React.ReactNode;
  buttons?: {
    primary?: {
      text: string;
      onClick?: () => void;
    };
    secondary?: {
      text: string;
      onClick?: () => void;
    };
  };
  primaryButtonNode?: React.ReactNode;
  className?: string;
}

const Hero: React.FC<HeroProps> = ({
  trustBadge,
  headline,
  headlineNode,
  subtitle,
  subtitleNode,
  buttons,
  primaryButtonNode,
  className = "",
}) => {
  return (
    <div className={`relative w-full h-screen overflow-hidden bg-black ${className}`}>
      <div className="absolute inset-0 overflow-hidden">
        <ShaderAnimation />
      </div>

      {/* Hero Content Overlay */}
      <div className="absolute inset-0 z-10 flex flex-col items-center justify-center text-white">
        {/* Trust Badge */}
        {trustBadge && (
          <div className="mb-8 animate-fade-in-down">
            <div className="flex items-center gap-2 px-6 py-3 bg-orange-500/10 backdrop-blur-md border border-orange-300/30 rounded-full text-sm">
              {trustBadge.icons && (
                <div className="flex">
                  {trustBadge.icons.map((icon, index) => (
                    <span
                      key={index}
                      className={`text-${index === 0 ? 'yellow' : index === 1 ? 'orange' : 'amber'}-300`}
                    >
                      {icon}
                    </span>
                  ))}
                </div>
              )}
              <span className="text-orange-100">{trustBadge.text}</span>
            </div>
          </div>
        )}

        <div className="text-center space-y-6 max-w-5xl mx-auto px-4">
          {/* Main Heading */}
          <div className="space-y-2 animate-fade-in-up animation-delay-200">
            {headlineNode ?? (
              <>
                <h1 className="text-5xl md:text-7xl lg:text-8xl font-bold bg-gradient-to-r from-orange-300 via-yellow-400 to-amber-300 bg-clip-text text-transparent">
                  {headline.line1}
                </h1>
                <h1 className="text-5xl md:text-7xl lg:text-8xl font-bold bg-gradient-to-r from-yellow-300 via-orange-400 to-red-400 bg-clip-text text-transparent">
                  {headline.line2}
                </h1>
              </>
            )}
          </div>

          {/* Subtitle */}
          <div className="max-w-3xl mx-auto animate-fade-in-up animation-delay-600">
            {subtitleNode ?? (
              <p className="text-lg md:text-xl lg:text-2xl text-orange-100/90 font-light leading-relaxed">
                {subtitle}
              </p>
            )}
          </div>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center mt-10 animate-fade-in-up animation-delay-800">
            {primaryButtonNode ?? (
              buttons?.primary && (
                <button
                  onClick={buttons.primary.onClick}
                  className="px-8 py-4 bg-gradient-to-r from-orange-500 to-yellow-500 hover:from-orange-600 hover:to-yellow-600 text-black rounded-full font-semibold text-lg transition-all duration-300 hover:scale-105 hover:shadow-xl hover:shadow-orange-500/25"
                >
                  {buttons.primary.text}
                </button>
              )
            )}
            {buttons?.secondary && (
              <button
                onClick={buttons.secondary.onClick}
                className="px-8 py-4 bg-orange-500/10 hover:bg-orange-500/20 border border-orange-300/30 hover:border-orange-300/50 text-orange-100 rounded-full font-semibold text-lg transition-all duration-300 hover:scale-105 backdrop-blur-sm"
              >
                {buttons.secondary.text}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Hero;
