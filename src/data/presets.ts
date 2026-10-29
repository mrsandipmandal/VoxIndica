import { VoicePreset, SupportedLanguage } from '../types';

export const VOICE_PRESETS: VoicePreset[] = [
  // Bengali - West Bengal Accent Target
  {
    id: 'voice-bn-arpita',
    name: 'Arpita (অর্পিতা)',
    nativeName: 'অর্পিতা মুখোপাধ্যায়',
    language: 'bn-IN',
    accent: 'West Bengal (Kolkata Standard)',
    gender: 'female',
    tag: 'সংবাদ ও অডিওবুক',
    samplePrompt: 'নমস্কার। ভক্সইন্ডিকা স্টুডিওতে আপনাকে স্বাগতম। বাংলা ভাষার শুদ্ধ ও প্রাঞ্জল উচ্চারণে আমরা স্পিচ সিন্থেসিস সম্পন্ন করছি।',
    speedDefault: 1.0,
    pitchDefault: 1.05
  },
  {
    id: 'voice-bn-subhash',
    name: 'Subhash (সুভাষ)',
    nativeName: 'সুভাষ সেনগুপ্ত',
    language: 'bn-IN',
    accent: 'West Bengal (Presidency Division)',
    gender: 'male',
    tag: 'গম্ভীর ও প্রাঞ্জল উপস্থাপনা',
    samplePrompt: 'আজকের আবহাওয়া ও প্রযুক্তি সংক্রান্ত বিশেষ প্রতিবেদনে আপনাদের স্বাগত জানাচ্ছি। বিজ্ঞান ও কৃত্রিম বুদ্ধিমত্তা আজ নতুন দিগন্ত উন্মোচন করছে।',
    speedDefault: 0.95,
    pitchDefault: 0.92
  },

  // Hindi - Indian Standard Target
  {
    id: 'voice-hi-aarav',
    name: 'Aarav (आरव)',
    nativeName: 'आरव शर्मा',
    language: 'hi-IN',
    accent: 'Standard Hindi (National Target)',
    gender: 'male',
    tag: 'आधिकारिक उद्घोषक',
    samplePrompt: 'नमस्कार। वॉक्सइंडिका स्टूडियो में आपका स्वागत है। शुद्ध देवनागरी उच्चारण और स्वाभाविक प्रवाह के साथ हम ध्वनि संश्लेषण करते हैं।',
    speedDefault: 1.0,
    pitchDefault: 0.98
  },
  {
    id: 'voice-hi-pooja',
    name: 'Pooja (पूजा)',
    nativeName: 'पूजा वर्मा',
    language: 'hi-IN',
    accent: 'Urban Conversational Hindi',
    gender: 'female',
    tag: 'मधुर एवं संवादात्मक',
    samplePrompt: 'नमस्ते! भारतीय भाषाओं की समृद्ध धरोहर को आधुनिक तकनीक से जोड़ना हमारा मुख्य उद्देश्य है। आइए मिलकर इस अनुभव को साझा करें।',
    speedDefault: 1.05,
    pitchDefault: 1.08
  },

  // Indian English
  {
    id: 'voice-en-ananya',
    name: 'Ananya (Indian English)',
    nativeName: 'Ananya Iyer',
    language: 'en-IN',
    accent: 'Pan-Indian English (Urban / Neutral)',
    gender: 'female',
    tag: 'Corporate & Educational',
    samplePrompt: 'Welcome to VoxIndica Studio. We provide production-grade speech synthesis with authentic Indian intonation, clear articulation, and zero artificial cadence.',
    speedDefault: 1.0,
    pitchDefault: 1.02
  },
  {
    id: 'voice-en-vikram',
    name: 'Vikram (Indian English)',
    nativeName: 'Vikram Malhotra',
    language: 'en-IN',
    accent: 'Indian English (Authoritative Narrative)',
    gender: 'male',
    tag: 'Documentary & Podcast',
    samplePrompt: 'The cultural mosaic of India encompasses hundreds of living dialects. Machine learning bridges these linguistic nuances with precision and empathy.',
    speedDefault: 0.95,
    pitchDefault: 0.90
  }
];

export const BENCHMARK_SENTENCES: Record<SupportedLanguage, { title: string; text: string; phoneticFocus: string }[]> = {
  'bn-IN': [
    {
      title: 'মান্য প্রমিত উচ্চারণ (Nasal Vowels & Conjuncts)',
      text: 'চাঁদনি রাতে গঙ্গার ঘাটে মৃদু হাওয়া বইছিল। ক্ষণিক অবসরে সুভাষবাবু রবীন্দ্রনাথের একটি কবিতা আবৃত্তি করতে শুরু করলেন।',
      phoneticFocus: 'চন্দ্রবিন্দু (চাঁদনি), যুক্তাক্ষর (ক্ষণিক, রবীন্দ্রনাথ), স্বরবর্ণের অনুনাসিকতা।'
    },
    {
      title: 'বিজ্ঞান ও প্রযুক্তি (Technical Cadence)',
      text: 'নিউরাল নেটওয়ার্কের মাধ্যমে পশ্চিমবঙ্গীয় আঞ্চলিক শব্দের স্বরলিপি নিখুঁতভাবে তৈরি করা সম্ভব হচ্ছে।',
      phoneticFocus: 'ইংরেজি কৃতঋণ শব্দ (নেটওয়ার্ক) ও তৎসম শব্দের সঙ্গতি।'
    }
  ],
  'hi-IN': [
    {
      title: 'मानक हिंदी गद्य (Aspiration & Nuqta Balance)',
      text: 'सूर्योदय के समय हिमालय की श्वेत चोटियां स्वर्णिम आभा से जगमगा उठती हैं। यह दृश्य अत्यंत मनोरम और अद्वितीय है।',
      phoneticFocus: 'महाप्राण व्यंजन (ख, घ, थ, ध), नुक्ता एवं संयुक्त व्यंजन (स्वर्णिम, अद्वितीय)।'
    },
    {
      title: 'संवाद एवं कथन (Conversational Rhythm)',
      text: 'क्या आपने कभी विचार किया है कि तकनीक हमारी भाषा की मिठास को कैसे संजो कर रख सकती है?',
      phoneticFocus: 'स्वाभाविक प्रश्नवाचक अनुतान (Intonation) और अल्पविराम ठहराव।'
    }
  ],
  'en-IN': [
    {
      title: 'Pan-Indian Articulation (Retroflex Stops & Non-rhoticity)',
      text: 'The committee decided that rapid infrastructure development across Kolkata, Bengaluru, and Delhi must preserve historical architecture.',
      phoneticFocus: 'Unaspirated /p, t, k/, retroflex /ʈ/ and /ɖ/, natural Indian English prosody.'
    },
    {
      title: 'Broadcast & Explainer (Syllable-timed Rhythm)',
      text: 'Digital public infrastructure in India has streamlined payments, healthcare, and educational access for millions.',
      phoneticFocus: 'Even stress distribution, crisp vowel transitions, avoid exaggerated caricature.'
    }
  ]
};
