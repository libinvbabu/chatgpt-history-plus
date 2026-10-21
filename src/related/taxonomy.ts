// The category taxonomy and the vocabulary the classifier (classify.ts) reads.
// Everything here is data: add a row to teach it a word.
//
//   Primary categories   eight, fixed. Every conversation gets exactly one.
//   Subcategories        a maintained list, each owned by one primary. A
//                        conversation gets one when its title says so clearly.
//   Topics               secondary tags derived per title (entities, other
//                        subcategories that matched). Never a filter of their own.
//
// Kept apart from TOPICS and ACTIVITY_RULES in dictionary.ts on purpose: those
// drive "Related to this chat", and teaching a category a word must never
// change what counts as related.
//
// Patterns run on the lower-cased title with punctuation turned into spaces
// ("Read-only" → "read only", "1:1" → "1 1", "Newton's" → "newton s").
// Weight: 3 = settles it on its own, 2 = clear, 1 = a hint (never enough alone:
// a category needs a score of 2).

export const PRIMARY_IDS = ['work', 'learning', 'writing', 'creative', 'technology', 'planning', 'personal', 'general'] as const
export type PrimaryId = (typeof PRIMARY_IDS)[number]

export const PRIMARY_LABELS: Record<PrimaryId, string> = {
  work: 'Work',
  learning: 'Learning',
  writing: 'Writing',
  creative: 'Creative',
  technology: 'Technology',
  planning: 'Planning',
  personal: 'Personal',
  general: 'General',
}

export interface SubcategoryDef {
  id: string
  parent: Exclude<PrimaryId, 'general'>
  label: string
}

const sub = (parent: SubcategoryDef['parent'], id: string, label: string): SubcategoryDef => ({ id, parent, label })

/** Grouped by primary, in the order the More menu lists them. Ids are unique across primaries and subcategories. */
export const SUBCATEGORIES: readonly SubcategoryDef[] = [
  sub('technology', 'pr-reviews', 'PR Reviews'),
  sub('technology', 'debugging', 'Debugging'),
  sub('technology', 'architecture', 'Architecture'),
  sub('technology', 'backend', 'Backend'),
  sub('technology', 'frontend', 'Frontend'),
  sub('technology', 'mobile', 'Mobile'),
  sub('technology', 'ai', 'AI & ML'),
  sub('technology', 'infrastructure', 'Infrastructure'),
  sub('technology', 'security', 'Security'),

  sub('work', 'meetings', 'Meetings'),
  sub('work', 'career', 'Career'),
  sub('work', 'hiring', 'Hiring'),
  sub('work', 'strategy', 'Strategy'),
  sub('work', 'marketing', 'Marketing'),
  sub('work', 'sales', 'Sales'),
  sub('work', 'management', 'Management'),
  sub('work', 'presentations', 'Presentations'),
  sub('work', 'product', 'Product'),
  sub('work', 'analytics', 'Analytics'),
  sub('work', 'payments', 'Payments'),

  sub('learning', 'exam-prep', 'Exam Prep'),
  sub('learning', 'research', 'Research'),
  sub('learning', 'mathematics', 'Mathematics'),
  sub('learning', 'science', 'Science'),
  sub('learning', 'languages', 'Languages'),
  sub('learning', 'history', 'History'),

  sub('writing', 'emails', 'Emails'),
  sub('writing', 'social-posts', 'Social Posts'),
  sub('writing', 'documents', 'Documents'),
  sub('writing', 'editing', 'Editing'),
  sub('writing', 'communication', 'Messages & Letters'),

  sub('creative', 'design', 'Design'),
  sub('creative', 'image-generation', 'Images'),
  sub('creative', 'stories', 'Stories & Poems'),
  sub('creative', 'brainstorming', 'Brainstorming'),
  sub('creative', 'content-creation', 'Content Creation'),

  sub('planning', 'scheduling', 'Scheduling'),
  sub('planning', 'goal-setting', 'Goals & Habits'),
  sub('planning', 'event-planning', 'Events'),
  sub('planning', 'task-organization', 'To-dos'),
  sub('planning', 'decision-making', 'Decisions'),

  sub('personal', 'travel', 'Travel'),
  sub('personal', 'cooking', 'Cooking'),
  sub('personal', 'health', 'Health & Fitness'),
  sub('personal', 'parenting', 'Parenting'),
  sub('personal', 'shopping', 'Shopping'),
  sub('personal', 'finance', 'Finance'),
  sub('personal', 'home', 'Home'),
  sub('personal', 'entertainment', 'Entertainment'),
]

export type Signals = Array<[pattern: RegExp, weight: 1 | 2 | 3]>

/**
 * A facet is what the scorer counts: a subcategory, or a primary's own
 * vocabulary (words that name the area but no particular part of it: "homework"
 * is Learning, but not Mathematics). Facet ids are subcategory or primary ids.
 */
export const FACET_SIGNALS: Record<string, Signals> = {
  // ------------------------------------------------------------ Technology
  technology: [
    [/\b(programming|software|coding|codebase|source code|compiler|algorithms?|data structures?|regex|regular expressions?|json|yaml|html|bash|shell scripts?|command line|cli|terminal|npm|linux|ubuntu|vs ?code|ide|sdk|open source|chrome extension|browser extension|github actions|stack overflow|unit tests?|test cases|integrat\w*(?! by parts)|parsers?|parsing)\b/, 3],
    [/\b(code|developers?|engineering|engineers?|technical|scripts?|librar(?:y|ies)|frameworks?|plugins?|website|web app|automat\w*|tests?|testing|compil\w*|release|logs?|sync|implement\w*|notifications?|repo|loops?|variables?|arrays?|strings? in|syntax)\b/, 2],
    [/\b(apps?|build|functions?|audio|video|calls?|calling|voip|events?|setup|set up|config\w*|tool(?:ing)?|computer|laptop|install\w*|version|push)\b/, 1],
  ],
  debugging: [
    // Faults that only software has. Generic ones ("not working", "broken") are FAULT_SIGNALS below: they need a technical subject.
    [/\b(bugs?|crash\w*|exceptions?|nullpointerexception|stack ?traces?|regressions?|outages?|incidents?|hotfix\w*|anrs?|memory leaks?|segfault|root cause|rca|postmortem|500 errors?|cors errors?|error codes?)\b/, 3],
    [/\b(timeouts?|latency|flaky|leaks?|consumer lag)\b/, 2],
    [/\b(call drops?|drop(?:ped|ping)? calls?)\b/, 2],
  ],
  architecture: [
    [/\b(architecture|refactor\w*|system design|microservices?|monolith|design patterns?|scalab\w*|high level design|hld|lld|data model|domain model|event driven|distributed systems?)\b/, 3],
    [/\b(modules?|modular\w*|clean code)\b/, 1],
  ],
  backend: [
    [/\b(backend|back end|apis?|endpoints?|webhooks?|database|databases|schema|sql|websockets?|graphql|rest api|grpc|orm|caching|cache|queues?|cron|server side|crud|rate limit\w*|pagination|database migrations?)\b/, 3],
    [/\b(server|query|queries|index|indexes|indexing|migrations?|background jobs?|consumer|producer)\b/, 2],
  ],
  frontend: [
    [/\b(frontend|front end|css|tailwind|ui components?|dom|responsive layout|single page app|spa|react hooks?|usestate|useeffect|component library|web page)\b/, 3],
    [/\b(components?|hooks?|state management|render\w*)\b/, 1],
  ],
  mobile: [
    [/\b(android|ios|react native|flutter|play store|app store|apk|xcode|mobile apps?|iphone app|android app)\b/, 3],
    [/\b(mobile)\b/, 1],
  ],
  ai: [
    [/\b(llms?|gpt|chatgpt|openai|claude|gemini|machine learning|ml models?|deep learning|neural networks?|embeddings?|rag|fine ?tun\w*|prompt engineering|langchain|transformers?|nlp|computer vision|ai agents?|agentic|vector (?:db|database|store))\b/, 3],
    [/\b(ai|artificial intelligence|prompts?|training data|datasets?)\b/, 2],
    [/\b(models?)\b/, 1],
  ],
  infrastructure: [
    [/\b(deploy\w*|ci ?cd|ci|kubernetes|k8s|docker\w*|terraform|devops|infra\w*|load balancers?|dns|ssl|cdn|autoscal\w*|clusters?|monitoring|observability|uptime|hosting|vps|s3 buckets?|helm)\b/, 3],
    [/\b(pipelines?|cloud|containers?|servers)\b/, 2],
  ],
  security: [
    [/\b(vulnerabilit\w*|pentest\w*|encryption|xss|csrf|2fa|mfa|sso|oauth|rbac|access control|access requests?|jwt)\b/, 3],
    [/\b(permissions?|security|credentials?|passwords?|secrets?|compliance|audit|auth|authentication|authori[sz]ation|authenticate|read only|tokens?)\b/, 2],
    [/\b(access|roles?)\b/, 1],
  ],

  // ------------------------------------------------------------------ Work
  work: [
    [/\b(at work|my boss|coworkers?|co workers?|colleagues?|workplace|office politics)\b/, 3],
    [/\b(office|clients?|business|company|corporate|employees?|vendors?|contracts?|excel|spreadsheets?|google sheets|vlookup|pivot tables?|saas|b2b|enterprise)\b/, 2],
    [/\b(work|team|manager|project|deadline|quarterly|q[1-4]|professional|weekly update)\b/, 1],
  ],
  meetings: [
    [/\b(agendas?|minutes of (?:the )?meeting|stand ?ups?|one on ones?|1 1|retros?|retrospectives?|all hands|town hall|offsites?|kick ?offs?|sync ups?)\b/, 3],
    [/\b(meetings?)\b/, 2],
  ],
  hiring: [
    [/\b(interview\w*|hiring|hire|candidates?|recruit\w*|job descriptions?|jd|offer letters?|appraisals?|performance reviews?|compensation|salary|salaries|attrition|notice period|screen\w* (?:resumes|candidates)|onboard\w* (?:new )?(?:hires?|employees?))\b/, 3],
    [/\b(promotions?|increments?|team building|new joiners?|hr|headcount|org charts?|resignations?)\b/, 2],
  ],
  career: [
    [/\b(resumes?|cv|cvs|curriculum vitae|cover letters?|job applications?|job search\w*|job hunt\w*|careers?|career change|linkedin profile|(?:prepare|preparing|prep|practi[cs]e|practi[cs]ing) (?:for )?(?:a |an |my |the )?(?:\S+ ){0,2}interviews?|interview (?:prep\w*|tips|questions)|mock interviews?|salary negotiation|negotiat\w* (?:my )?(?:salary|offer)|job offers?|internships?|layoffs?|laid off|star method)\b/, 3],
    [/\b(jobs?|recruiters?|ats|offer|apply\w* for)\b/, 2],
  ],
  strategy: [
    [/\b(business strateg\w*|strategy (?:deck|doc|document)|swot|go to market|gtm|competitors?|competitive analysis|competitor analysis|market research|market sizing|business plan|business models?|pitch decks?|investors?|fundraising|funding rounds?|valuation|okrs?|positioning)\b/, 3],
    [/\b(strateg\w*|expansion|market|vision|startups?)\b/, 2],
  ],
  marketing: [
    [/\b(marketing|seo|ad copy|ad campaigns?|google ads|facebook ads|meta ads|campaigns?|branding|brand (?:strategy|voice|guidelines|identity)|email marketing|growth hack\w*|landing pages?|influencers?|social media (?:strategy|marketing|plan|calendar)|target audience|copywriting)\b/, 3],
    [/\b(brand|audience|keywords|promo)\b/, 2],
  ],
  sales: [
    [/\b(sales|lead gen\w*|leads|prospects?|prospecting|crm|salesforce|hubspot|cold (?:emails?|outreach|calls?)|outreach|sales pitch|sales pipeline|deal pipeline|quotations?|upsell\w*|cross sell\w*|rfp|customer acquisition)\b/, 3],
    [/\b(pitch|deals?|quotes?)\b/, 2],
  ],
  management: [
    [/\b(project management|project plans?|project timelines?|delegat\w*|stakeholders?|team (?:management|structure|process|feedback|performance|goals|morale)|managing (?:a |my )?team|people management|status updates?|sops?|process (?:improvement|documentation)|workflows?|escalations?|performance improvement plan)\b/, 3],
    [/\b(leadership|team leads?|feedback|resourcing|capacity planning|sprints?|my team)\b/, 2],
  ],
  presentations: [
    [/\b(presentations?|slides?|slide deck|decks?|ppt|powerpoint|keynote|google slides)\b/, 3],
  ],
  product: [
    [/\b(prd|roadmaps?|ux|user experience|wireframes?|mockups?|mvp|user research|personas?|ideation|feature requests?|user stor(?:y|ies)|pain points|product (?:manager|management|spec|requirements|launch|strategy|roadmap|design))\b/, 3],
    [/\b(features?|pricing|launch|requirements|spec|proposals?|user flows?|onboarding flow|product|sidebar|ui|redesign)\b/, 2],
    [/\b(improve\w*|screens?|page|experience|users?|flow)\b/, 1],
  ],
  analytics: [
    [/\b(analytics|funnels?|dashboards?|cohorts?|discrepanc\w*|attribution|kpis?|mau|dau|gmv|arpu|ltv|cac|amplitude|mixpanel|clevertap|metabase|bigquery|looker|tableau|posthog|appsflyer|google analytics|ga4|conversion rates?|power bi)\b/, 3],
    [/\b(analys[ie]s|analy[sz]e|metrics?|tracking|reports?|reporting|revenue|retention|churn|a b test\w*|ab test\w*|experiments?|insights?|forecast\w*|trends?)\b/, 2],
    [/\b(data|numbers|stats|events?|conversion)\b/, 1],
  ],
  payments: [
    // The merchant's side of money: what a business takes, settles and reconciles.
    [/\b(payments?|payouts?|refunds?|upi|mandates?|autopay|auto pay|checkout|cashback|settlements?|reconciliation|chargebacks?|dunning|prenotify|pre notify|payment gateway|emi)\b/, 2],
    [/\b(subscriptions?|billing|invoices?|wallet|debit|transactions?|gateway|recurring|renewals?|charges?)\b/, 2],
    [/\b(credit|coupons?|price)\b/, 1],
  ],

  // -------------------------------------------------------------- Learning
  learning: [
    [/\b(homework|assignments?|coursework|syllabus|semester|class \d+|grade \d+|std \d+|standard \d+|school (?:project|assignment|homework)|lecture\w*|study notes|study guide|studying|revise|revision|tutor\w*|teach me|eli5|explain like i m 5|flashcards?|textbooks?|worksheets?|online courses?|crash course|lesson plans?|curriculum|for beginners|beginner s guide)\b/, 3],
    [/\b(learn|learning|study|understand\w*|concepts?|tutorials?|chapters?|lessons?|school|college|university|students?|teacher|courses?|quiz\w*|difference between|what is|what are|how does|how do|why do|why does)\b/, 2],
    [/\b(explain\w*|meaning of|definition|examples?|class|notes)\b/, 1],
  ],
  mathematics: [
    [/\b(math|maths|mathematics|algebra|calculus|geometry|trigonometry|equations?|derivatives?|integrals?|integration by parts|probability|statistics|theorems?|proofs?|fractions?|quadratic|polynomials?|matrix|matrices|linear algebra|arithmetic|logarithms?|differential equations?|permutations?|combinations?|standard deviation|pythagoras|word problems?)\b/, 3],
    [/\b(percentages?|solve|formulas?|vectors?|graphs?)\b/, 2],
  ],
  science: [
    [/\b(physics|chemistry|biology|photosynthesis|atoms?|molecules?|cell (?:structure|division|biology)|cell structure|mitosis|meiosis|evolution|gravity|newton s laws?|laws of motion|thermodynamics|quantum|electrons?|chemical (?:reactions?|equations?|bonds?)|balancing equations|periodic table|dna|genetics|ecosystems?|astronomy|planets?|solar system|human body|anatomy|organic chemistry|acids?|velocity|acceleration|magnetism|optics|botany|zoology|geology|vaccines?|volcano\w*|science)\b/, 3],
    [/\b(experiments?|energy|climate change|scientific)\b/, 2],
  ],
  'exam-prep': [
    [/\b(exams?|exam prep\w*|test prep|mock tests?|practice (?:questions|tests?|papers?)|previous year (?:questions|papers)|pyq|sat|gre|gmat|ielts|toefl|jee|neet|upsc|gate exam|cat exam|board exams?|finals|midterms?|entrance (?:exam|test)s?|competitive exams?|aptitude|mcqs?|question papers?|sample papers?)\b/, 3],
    [/\b(quiz|quizzes|marks|preparation)\b/, 2],
  ],
  research: [
    [/\b(literature review|thesis|dissertation|citations?|research papers?|journal articles?|academic papers?|hypothes[ie]s|methodology|peer review\w*|systematic review|phd|sources for)\b/, 3],
    [/\b(research\w*|papers?|studies|findings|evidence)\b/, 2],
  ],
  languages: [
    [/\b(spanish|french|german|italian|portuguese|japanese|mandarin|chinese|korean|arabic|russian|hindi|tamil|malayalam|telugu|kannada|bengali|marathi|urdu|vocabulary|pronunciation|conjugat\w*|translat\w*|idioms?|duolingo|esl|language learning|fluency|fluent|grammar)\b/, 3],
    [/\b(english|phrases?|words in)\b/, 1],
  ],
  history: [
    [/\b(world history|history of|historical|ancient|medieval|empires?|civili[sz]ations?|dynast\w*|world wars?|ww1|ww2|wwi|wwii|cold war|revolutions?|independence movement|freedom struggle|renaissance|mughals?|colonial\w*|archaeolog\w*)\b/, 3],
    [/\b(kings?|battles?|war)\b/, 2],
    [/\b(history)\b/, 1],
  ],

  // --------------------------------------------------------------- Writing
  writing: [
    [/\b(help me write|ghostwrit\w*)\b/, 3],
    [/\b(draft\w*|compose|wording|write ups?)\b/, 2],
    [/\b(write|writing|copy|text|words?)\b/, 1],
  ],
  emails: [
    [/\b(emails?|e mails?|mail|reply|replies|respond to|subject lines?|inbox|out of office|follow ?up emails?)\b/, 3],
    [/\b(messages?|whatsapp|dm)\b/, 2],
  ],
  'social-posts': [
    [/\b(linkedin|tweets?|twitter|x thread|instagram (?:captions?|posts?|bio)|captions?|hashtags?|facebook posts?|social media posts?|reddit posts?|threads?)\b/, 3],
    [/\b(posts?)\b/, 2],
  ],
  documents: [
    [/\b(essays?|articles?|blog\w*|documentation|docs|readme|press release|memos?|white ?papers?|statement of purpose|sop for|user guide|manual|case stud(?:y|ies)|newsletters?|reports? on)\b/, 3],
    [/\b(outline|guides?|tutorial)\b/, 1],
  ],
  editing: [
    [/\b(proofread\w*|rewrite|rewriting|rephrase|paraphras\w*|grammar check|spell check|edit (?:my|this)|editing|polish|make (?:it|this) (?:more )?(?:concise|formal|professional|shorter|better|friendlier)|shorten|summari[sz]\w*|summary|summaries|tl ?dr|improve (?:my|this) (?:writing|text|paragraph|essay|intro\w*|draft)|sound (?:more )?\w+er|tone)\b/, 3],
    [/\b(feedback on (?:my )?(?:essay|writing|draft|intro\w*)|fix (?:my )?grammar|paragraph|introduction)\b/, 2],
  ],
  communication: [
    [/\b(cover letters?|letters?|announcements?|heads up|thank you(?: note| message)?|invitations?|speech(?:es)?|toasts?|wish(?:es)?|greetings?|apolog\w*|resignation letter|recommendation letter|condolence\w*|farewell (?:message|note|speech)|welcome (?:note|message)|introduc\w* myself|bios?|eulogy)\b/, 3],
    [/\b(invites?|notes?|card)\b/, 1],
  ],

  // -------------------------------------------------------------- Creative
  creative: [
    [/\b(creative|art|artwork|artistic|aesthetic|crafts?|diy|inspiration)\b/, 2],
    [/\b(design|sketch|style)\b/, 1],
  ],
  design: [
    [/\b(logos?|graphic design|posters?|flyers?|banners?|brochures?|colou?r palettes?|colou?r schemes?|typography|fonts?|visual identity|mood ?boards?|tattoo design|packaging design|infographics?|canva|figma)\b/, 3],
    [/\b(layout|visuals?)\b/, 2],
  ],
  'image-generation': [
    [/\b(illustrations?|drawings?|paintings?|watercolou?rs?|portraits?|cartoons?|wallpapers?|avatars?|profile pictures?|dall e|midjourney|stable diffusion|generate (?:an |a )?(?:image|picture|photo)|digital art|pixel art|anime style|3d render)\b/, 3],
    [/\b(images?|pictures?|anime|render)\b/, 2],
  ],
  stories: [
    [/\b(stor(?:y|ies)|poems?|poetry|fiction|novels?|fairy tales?|lyrics|screenplay|fan ?fiction|plot|characters?|worldbuilding|narrative|haiku|limerick|storytelling|rap verse)\b/, 3],
    [/\b(song|verse)\b/, 2],
  ],
  brainstorming: [
    [/\b(brainstorm\w*|name ideas|names for|naming|taglines?|slogans?|creative ideas)\b/, 3],
    [/\b(ideas)\b/, 2],
    [/\b(concepts?|themes?|suggestions?)\b/, 1],
  ],
  'content-creation': [
    [/\b(youtube|video scripts?|script for (?:a |my )?(?:video|reel|youtube|podcast)|podcasts?|reels?|tiktok|vlogs?|thumbnails?|content (?:ideas|calendar|plan|strategy|creation|creator)|channel (?:name|ideas|growth))\b/, 3],
    [/\b(shorts|episodes?|channel)\b/, 2],
  ],

  // -------------------------------------------------------------- Planning
  planning: [
    [/\b(planner)\b/, 3],
    [/\b(planning|organi[sz]\w*)\b/, 2],
    [/\b(plan|plans|prepare|steps)\b/, 1],
  ],
  scheduling: [
    [/\b(schedules?|timetables?|calendar|routines?|time blocking|time management|appointments?)\b/, 3],
    [/\b(deadlines?)\b/, 2],
    [/\b(tomorrow|today|this week|weekly|daily)\b/, 1],
  ],
  'goal-setting': [
    [/\b(goals?|goal setting|resolutions?|habits?|habit track\w*|vision board|life plan|\d+ year plan|milestones?|self improvement|personal development)\b/, 3],
    [/\b(motivation|discipline|productivity)\b/, 2],
  ],
  'event-planning': [
    [/\b(party|parties|weddings?|celebrations?|anniversar(?:y|ies)|baby shower|bachelor\w*|reunions?|guest lists?|venues?|decorations?|festivals?|fundraisers?|potluck|event planning)\b/, 3],
    [/\b(events?|birthday)\b/, 2],
  ],
  'task-organization': [
    [/\b(to ?do lists?|to ?dos?|checklists?|task lists?|prioriti[sz]\w*|kanban|declutter\w*|chores|errands|getting things done)\b/, 3],
    [/\b(tasks?|organi[sz]e|organi[sz]ing)\b/, 2],
  ],
  'decision-making': [
    [/\b(pros and cons|should i|decid\w*|decisions?|which (?:one|is better|should)|choos\w* between|help me choose|vs|versus|better option|or not)\b/, 3],
    [/\b(options|compare|comparison)\b/, 2],
  ],

  // -------------------------------------------------------------- Personal
  personal: [
    [/\b(relationships?|dating|breakup|break up|friendship|self care|hobb(?:y|ies)|life advice|journal\w*|gratitude|spiritual\w*|astrology|horoscope|my (?:wife|husband|girlfriend|boyfriend|partner|mom|mother|dad|father|parents|sister|brother|friends?|family))\b/, 3],
    [/\b(personal|family|weekend|life|friends?|heart)\b/, 1],
  ],
  travel: [
    [/\b(trips?|travel\w*|itinerar\w*|vacations?|holidays?|flights?|hotels?|hostels?|visa|passport|packing list|backpack\w*|road trip|honeymoon|airbnb|places to visit|things to do in|sightseeing|touris\w*|cruise|beach(?:es)?|trek\w*|camping|layover|airport|train tickets?|resort)\b/, 3],
    [/\b(booking|bookings|destinations?|abroad|getaway|tour)\b/, 2],
  ],
  cooking: [
    [/\b(recipes?|cook\w*|bak(?:e|ing|ed)|meal (?:plan|prep|planning|ideas)\w*|meals?|dinner|lunch|lunchbox|breakfast|snacks?|dish(?:es)?|curry|biryani|cakes?|bread|pasta|salad|soups?|smoothies?|vegan|vegetarian|ingredients?|cuisine|sourdough|air fryer|instant pot|paneer|dal)\b/, 3],
    [/\b(food|kitchen|eggs|chicken|rice|chocolate)\b/, 1],
  ],
  health: [
    [/\b(health|healthy|workouts?|gym|exercises?|fitness|diet\w*|weight loss|lose weight|calories|protein|yoga|meditat\w*|symptoms?|doctor|medicines?|medication|headaches?|fever|cough|dizz\w*|pain|injur\w*|therapy|therapist|mental health|anxiety|depression|skin ?care|hair (?:fall|loss|care)|nutrition|marathon|blood (?:test|pressure|sugar)|diabetes|cholesterol|vitamins?|supplements?|allerg\w*|dentist|physio\w*)\b/, 3],
    [/\b(sleep\w*|stress|running|run|steps|weight)\b/, 2],
  ],
  parenting: [
    [/\b(parenting|kids?|child|children|toddlers?|bab(?:y|ies)|newborn|infant|son|daughter|teen(?:ager)?s?|preschool|kindergarten|school admission|bedtime|potty|breastfeed\w*|pregnan\w*|nanny|daycare|screen time|\d+ year old)\b/, 3],
    [/\b(parents?|mom|mother|dad|father|grandparents?|family)\b/, 2],
  ],
  shopping: [
    [/\b(buy\w*|purchas\w*|shopping|best (?:\S+ ){1,4}(?:under|below) \d+|gifts?|gift ideas|deals?|discounts?|amazon|flipkart|myntra|wishlist|grocer(?:y|ies)|worth buying|which (?:\S+ ){0,2}to buy)\b/, 3],
    [/\b(laptops?|phones?|smartphones?|iphone \d*|pixel \d*|macbook|headphones|earbuds|tv|television|camera|mattress|sofa|shoes|sneakers|smartwatch|air purifier|washing machine|fridge|refrigerator|appliances?)\b/, 2],
  ],
  finance: [
    [/\b(personal finance|budget\w*|savings?|save money|invest\w*|mutual funds?|sip|stocks?|index funds?|etfs?|crypto\w*|bitcoin|tax\w*|itr|loans?|mortgage|home loan|credit cards?|credit score|insurance|retirement|pension|fds?|fixed deposits?|ppf|expenses?|expense tracker|net worth|emergency fund|financial|debt|household budget)\b/, 3],
    [/\b(money|income|salary)\b/, 1],
  ],
  home: [
    [/\b(home (?:renovation|decor|improvement|repairs?|cleaning|organi[sz]ation)|house|apartment|rent|renting|landlord|tenant|furniture|renovation|interior\w*|decor\w*|cleaning|laundry|garden\w*|plants?|moving house|relocat\w*|plumbing|electrician|pets?|dogs?|puppy|cats?|kitten|aquarium|snake|stains?|pantry)\b/, 3],
    [/\b(repair\w*|not working|washing machine|fridge|refrigerator|appliances?)\b/, 2],
    [/\b(home|kitchen|room|sofa)\b/, 1],
  ],
  entertainment: [
    [/\b(movies?|films?|tv shows?|series|netflix|prime video|web series|books? (?:to read|recommendations?)|book recommendations?|reading list|music|songs|playlists?|games?|gaming|video games?|board games?|cricket|football|soccer|ipl|nba|sports?|concerts?|concert tickets|k ?dramas?|binge|trivia|puzzles?|riddles?|jokes?|memes?|fun facts?|anime (?:recommendations|series|to watch))\b/, 3],
    [/\b(books?|novel|watch|fun)\b/, 1],
  ],
}

/**
 * Generic faults: "not working", "broken", "fails". Software when the title is
 * technical ("API not working"), otherwise not ("my washing machine is not
 * working"). Counted toward Debugging only when Technology already has evidence.
 */
export const FAULT_SIGNALS: Signals = [
  [/\b(errors?|broken|not (?:working|showing|loading|opening|receiving|getting delivered|updating|syncing))\b/, 3],
  [/\b(fail(?:s|ed|ing|ures?)?|slow|stuck|drops?)\b/, 2],
  [/\b(investigat\w*|fix(?:es|ed|ing)?|issues?|wrong|mismatch\w*)\b/, 1],
]

/** A title that names a pull request, or a review of code, is a PR review whatever it is about. */
export const PR_REVIEW_SIGNALS: RegExp[] = [
  /\b(pr|prs|pull requests?|merge requests?)\b/, // not "MR": too often a person ("Mr Sharma")
  /\bcode ?reviews?\b/,
  // "Review Kisan backend changes", "review the diff", "reviewing my commits"
  /\breview(?:ing|ed)? (?:\S+ ){0,3}(?:changes|diffs?|commits?|code|branch|patch(?:es)?)\b/,
]

/** "Debug …" names the activity outright: debugging, whatever is being debugged. */
export const DEBUG_VERB = /\bdebug(?:s|ged|ging)?\b/

/** A title that opens with a writing verb asks for a piece of writing ("Write a Python tutorial"). */
export const WRITING_VERB = /^(?:please )?(?:help me )?(?:write|draft|compose|rewrite|rephrase|proofread|paraphrase|edit)\b/

/**
 * Known tools and providers (dictionary.ts ENTITY_DEFS) and the facet each
 * leans toward, with a weight like a signal's. A provider is a payments
 * company; repositories, issues and tickets are technology.
 */
export const ENTITY_FACETS: Record<string, [facet: string, weight: 1 | 2 | 3]> = {
  mixpanel: ['analytics', 3],
  clevertap: ['analytics', 3],
  bigquery: ['analytics', 3],
  metabase: ['analytics', 3],
  figma: ['design', 2],
  jira: ['product', 2],
  notion: ['task-organization', 2],
  slack: ['work', 1],
  react: ['frontend', 2],
  nextjs: ['frontend', 2],
  android: ['mobile', 2],
  ios: ['mobile', 2],
  flutter: ['mobile', 2],
  kotlin: ['mobile', 2],
  swift: ['mobile', 2],
  aws: ['infrastructure', 2],
  gcp: ['infrastructure', 2],
  azure: ['infrastructure', 2],
  kubernetes: ['infrastructure', 2],
  docker: ['infrastructure', 2],
  terraform: ['infrastructure', 2],
  nginx: ['infrastructure', 2],
  jenkins: ['infrastructure', 2],
  datadog: ['infrastructure', 2],
  sentry: ['infrastructure', 2],
  grafana: ['infrastructure', 2],
  prometheus: ['infrastructure', 2],
  postgres: ['backend', 2],
  mysql: ['backend', 2],
  mongodb: ['backend', 2],
  redis: ['backend', 2],
  elasticsearch: ['backend', 2],
  kafka: ['backend', 2],
  rabbitmq: ['backend', 2],
  celery: ['backend', 2],
  django: ['backend', 2],
  flask: ['backend', 2],
  fastapi: ['backend', 2],
  laravel: ['backend', 2],
  springboot: ['backend', 2],
  nodejs: ['backend', 2],
  firebase: ['backend', 2],
}

/**
 * Categories from History+ 0.2 and earlier, as stored filter selections and as
 * stored `category` values, and where each lives now. Nothing was ever written
 * by the title rules, so these only appear from a remembered chip or an import.
 */
export const LEGACY_CATEGORY_IDS: Record<string, string> = {
  'code-review': 'pr-reviews',
  engineering: 'technology',
  people: 'hiring',
  other: 'general',
  // Unchanged ids, listed so the mapping is complete: debugging, security, payments, analytics, product, writing, general, pr-reviews.
}
