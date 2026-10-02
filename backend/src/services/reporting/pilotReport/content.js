/*
 * Ported 1:1 from the Santulan pilot kit's santulan_gen/content.py ("AUTHORED SAMPLE copy", status OD-13: needs content
 * review before release). This is the pilot kit's OWN wording bank - a direct analogue of our own interpretation_rules /
 * Report wording admin page, just stored in a file instead of a database, with the same kind of approval gate
 * (CONTENT_APPROVED below). It stays false here exactly as it does in the kit: this port does not approve anything, it
 * only reproduces the kit's generator faithfully. Wording rules the kit itself documents: "suggest"/"may", no evaluative
 * labels, no cross-domain comparison, no deficit language, nothing about subdomains.
 *
 * Structure is per language; only 'en' exists in the source (the kit's own REN-17 hook for other languages).
 */

const CONTENT_APPROVED = false; // flips to true only after the kit's own OD-13 sign-off; --final refuses to run while false

const DOM = {
  C1: {
    pattern: {
      high: "You seem to notice your body's signals often, and you have a good base for looking after your energy and rest. Busy or stressful weeks may still make those signals easier to miss.",
      mid: "You seem to notice your body's signals fairly often, and looking after your energy and rest is something you can keep building on. Busy or stressful weeks may make those signals easier to miss.",
      low: 'Noticing your body\'s signals, like tiredness or tension, may be a useful capability to explore. Paying attention to them a little more often can help you look after your energy and rest.',
    },
    d1: {
      high: 'You often notice what your body is telling you. That helps you rest when you need to.',
      mid: "You notice your body's signals fairly often. You can keep building this habit.",
      low: 'Noticing signals like tiredness or tension may be a good thing to practise.',
    },
    about: 'This is about noticing tiredness, tension and hunger early, and what you do next.',
    ask: 'When did my body last tell me it needed a break, and what did I do?',
    steps: [
      'Once a day, pause and name one signal your body is giving you, like a tight tummy or a fast heartbeat. Do not judge it.',
      'Pick a regular cue, like the break between classes, to check in with your body.',
      'Notice what helped when you felt tired or tense, and repeat it.',
    ],
    ifthen: ['I notice I am tired or tense', 'I will take a short break before carrying on'],
  },
  C2: {
    pattern: {
      high: 'You seem to notice and make sense of many of your feelings. Strong feelings can still be hard to sort out in the moment, which is very common.',
      mid: 'You seem to notice many of your feelings. In some situations they may be harder to sort out in the moment, which is very common at your age.',
      low: 'Making sense of your feelings as they happen may be a useful capability to explore. Naming a feeling and what set it off can make it easier to handle.',
    },
    d1: {
      high: 'You often notice how you feel. Big feelings can still be hard to sort out, and that is normal.',
      mid: 'You notice many of your feelings. Some are harder to sort out in the moment, and that is normal.',
      low: 'Working out what you feel, and why, may be a good thing to practise.',
    },
    about: 'This is about spotting what you feel, what set it off, and what helps you settle.',
    ask: 'Which feeling showed up most this week, and what was going on around it?',
    steps: [
      'Pick one feeling you had today and write one sentence about what set it off.',
      'Give the feeling a name and a size (small, medium or big) as it happens.',
      'After a week, read your notes and look for patterns.',
    ],
    ifthen: ['a strong feeling shows up', 'I will name it before I decide what to do'],
  },
  C3: {
    pattern: {
      high: 'Your responses suggest several relational capabilities you can build from, with room to strengthen how you handle specific situations with others.',
      mid: 'Your responses suggest some relational capabilities you can build from, and some situations with others that may be worth a closer look.',
      low: 'Handling situations with other people may be a useful capability to explore. Small habits, like asking a question before assuming, can help.',
    },
    d1: {
      high: 'You have several strengths in working with other people. Some situations can still be tricky, and that is normal.',
      mid: 'You have some strengths in working with others. A few situations may be worth a closer look.',
      low: 'Handling situations with other people may be a good thing to practise.',
    },
    about: 'This is about reading situations with other people and speaking up in a way that feels right for you.',
    ask: 'Think of a recent conversation that went well. What did I do that helped?',
    steps: [
      'When a social moment feels confusing, ask yourself "What did I actually see or hear?" before "What does it mean?"',
      'Try one open question in a conversation this week.',
      'Notice which conversations felt easier, and what made them so.',
    ],
    ifthen: ["someone's reaction confuses me", 'I will ask myself what I actually saw or heard first'],
  },
  C4: {
    pattern: {
      high: 'Your responses suggest a fairly steady picture of who you are. Trying new things can make that picture clearer over time.',
      mid: 'Your picture of yourself seems to be taking shape. It can become clearer as you try new activities and hear how others see you.',
      low: 'Your picture of yourself may still be taking shape, which is normal. Trying new activities can help you find out what feels like you.',
    },
    d1: {
      high: 'You have a fairly steady picture of who you are. New experiences can make it clearer.',
      mid: 'Your picture of yourself is taking shape. New activities can help it grow.',
      low: 'Your picture of yourself is still taking shape, and that is normal.',
    },
    about: 'This is about how you describe yourself, and how that picture can grow as you try new things.',
    ask: 'What is one thing I enjoy that other people might not know about me?',
    steps: [
      'Once a week, write down one thing you did that felt like "you".',
      'Try one new small activity and notice how it felt.',
      'Ask one trusted person what they enjoy about working or spending time with you.',
    ],
    ifthen: ['I try something new', 'I will note one thing about it that felt like me'],
  },
  C5: {
    pattern: {
      high: 'You seem to have a fairly clear sense of what matters to you and how you might steer towards it. Keeping that connected to small steps can help it stay useful.',
      mid: 'You seem to have some sense of what matters to you. Linking it to small steps can help you steer towards your future.',
      low: 'Connecting what matters to you with steps you can take now may be a useful capability to explore.',
    },
    d1: {
      high: 'You have a fairly clear idea of what matters to you. Small steps help you move towards it.',
      mid: 'You have some idea of what matters to you. Small steps can help.',
      low: 'Linking what matters to you with small steps may be a good thing to practise.',
    },
    about: 'This is about connecting what matters to you with small steps you can take now.',
    ask: 'What is something I would do even if nobody was watching?',
    steps: [
      'Write down one thing that matters to you.',
      'Choose one small step towards it that fits into this week.',
      'At the end of the week, check whether the step still feels right.',
    ],
    ifthen: ['I have ten free minutes', 'I will do my small step'],
  },
  C6: {
    pattern: {
      high: 'You seem to adjust well to a good number of changes. Some plans changing suddenly may still be hard, and that is normal.',
      mid: 'You seem to adjust to many changes in your own way. Some situations may take longer, and that is normal.',
      low: 'Adapting your approach during change may be a useful capability to explore. It is about what you try next when something does not go as planned.',
    },
    d1: {
      high: 'You adjust well to many changes. Sudden changes can still be hard.',
      mid: 'You adjust to many changes in your own way. Some take longer, and that is normal.',
      low: 'Adjusting when plans change may be a good thing to practise.',
    },
    about: 'This is about how you respond when something does not go as planned, and what you try next.',
    ask: 'When plans changed recently, what helped me adjust?',
    steps: [
      'Identify more than one possible way to read or approach a problem you can manage.',
      'When a plan changes, name what happened, what it means, and one next action.',
      'Look back at what helped you adjust, and keep it.',
    ],
    ifthen: ['new information challenges my approach', 'I will consider at least one alternative before deciding'],
  },
  C7: {
    pattern: {
      high: 'You seem to plan and start your learning tasks fairly well. Keeping a first step small can help on the days it feels hard.',
      mid: 'You seem to manage many learning tasks on your own. Turning intentions into a first step may help with the ones you keep putting off.',
      low: 'Turning intentions into a first step may be a useful capability to explore, especially for tasks you have been putting off.',
    },
    d1: {
      high: 'You plan and start your work fairly well. A small first step helps on hard days.',
      mid: 'You manage many tasks on your own. A small first step can help with the ones you put off.',
      low: 'Getting started on tasks you put off may be a good thing to practise.',
    },
    about: 'This is about getting started on things that matter to you, even when you do not feel fully ready.',
    ask: 'What is one thing I keep putting off, and what makes it feel so big?',
    steps: [
      'Define the smallest useful first step for a task you have been postponing. Just that step.',
      'Use a specific cue to start the first step without waiting to feel fully ready.',
      'Review what made starting easier or harder, then adjust your cue.',
    ],
    ifthen: ['I notice myself delaying an important task', 'I will begin with the smallest defined action'],
  },
};

// icons per domain (24-unit line icons, from the kit's own approved sample)
const ICON = {
  C1: '<path d="M2 14h5l3-8 4 15 3-9 2 2h5"/>',
  C2: '<circle cx="13" cy="13" r="10"/><path d="M8.5 15c1 2.4 3 3.5 4.5 3.5s3.5-1.1 4.5-3.5M9 10h.01M17 10h.01"/>',
  C3: '<circle cx="9" cy="10" r="4"/><circle cx="18" cy="11" r="3"/><path d="M2 22c0-4 3-6 7-6s7 2 7 6M16 17c4 0 8 1 8 5"/>',
  C4: '<circle cx="13" cy="9" r="5"/><path d="M4 23c0-5 4-8 9-8s9 3 9 8"/>',
  C5: '<path d="M13 2l3 7 7 .8-5.2 4.7 1.5 7.5L13 18.5 6.7 22l1.5-7.5L3 9.8 10 9z"/>',
  C6: '<path d="M3 18c4-9 8 5 12-4s5-6 8-9M18 5h5v5"/>',
  C7: '<path d="M4 5h7a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H4zM22 5h-7a2 2 0 0 0-2 2v14a2 2 0 0 1 2-2h7z"/>',
};

// clusters: fg / bg / badge bg / dashed line (all fg pass 4.5 contrast on bg, per the kit's sheet 28)
const CLUSTER = {
  A: { name: 'Body & Feelings', fg: '#B23A66', bg: '#FBE9EF', badge: '#F5C6D6', dash: '#E0A6BB' },
  B: { name: 'Self & Others', fg: '#5A4BA8', bg: '#ECE9FA', badge: '#CFC8F0', dash: '#B3A9E3' },
  C: { name: 'Direction & Learning', fg: '#8A5A00', bg: '#FCF1D4', badge: '#F6DC93', dash: '#E1C574' },
};
const CLUSTER_ICON = {
  A: '<path d="M22 38C10 30 6 22 6 16a8 8 0 0 1 16-2 8 8 0 0 1 16 2c0 6-4 14-16 22z"/>',
  B: '<circle cx="16" cy="22" r="10"/><circle cx="28" cy="22" r="10"/>',
  C: '<circle cx="22" cy="22" r="16"/><path d="M28 16l-4 10-10 4 4-10z"/>',
};

// goals -> domains that can connect to them, with a short reason (the kit's focus page, REL-07)
const GOALS = {
  Studies: [['C7', 'planning and starting your work'], ['C3', 'group study and asking for help'], ['C1', 'the rest and energy that good study needs']],
  'Health and energy': [['C1', 'noticing and looking after your energy'], ['C2', 'handling stress and strong feelings']],
  'Friendships and teamwork': [['C3', 'getting along and working with others'], ['C2', 'understanding your own feelings in group moments']],
  'Personal growth': [['C4', 'knowing what feels like you'], ['C6', 'learning from things that do not go as planned'], ['C2', 'understanding your feelings']],
  'Plans for my future': [['C5', 'connecting today to what matters'], ['C7', 'turning plans into first steps'], ['C6', 'adjusting when plans change']],
};

const STEP_TAGS = [
  ['STEP 1 · FOUNDATION', 'Up to 15 min', '#1F7A63', '#E4F4EE'],
  ['STEP 2 · PRACTICE', '10–30 min', '#5A4BA8', '#F1EEFB'],
  ['STEP 3 · TRANSFER', '15–45 min', '#8A5A00', '#FCF1D4'],
];

// forbidden terms in generated text (the kit's REN-03, FT-1). Applied after removing allow-listed static phrases.
const FORBIDDEN = [
  'weak', 'poor', 'bad ', 'fail', 'deficit', 'disorder', 'diagnos', 'percentile', 'rank ', 'ranked',
  'better than', 'worse than', 'highest', 'lowest', 'strongest', 'weakest', 'best area', 'worst',
  'below average', 'above average', 'normal range', 'risk', 'talent', 'self-worth', 'savoring', 'savouring',
  'you are a ', 'you are an ', 'personality type', 'iq ',
];
const RETIRED = ['self-awareness', 'self awareness', 'self-assessment', 'self assessment']; // the kit's sheet 34 TRM-01, REN-21
const ALLOW = [
  'not ranked', 'not ranks', 'not weaknesses', 'not a low score', 'not marks, grades or ranks', 'not a final verdict',
  'not compared with other students', 'it is not a test', 'not directly comparable',
];

module.exports = { CONTENT_APPROVED, DOM, ICON, CLUSTER, CLUSTER_ICON, GOALS, STEP_TAGS, FORBIDDEN, RETIRED, ALLOW };
