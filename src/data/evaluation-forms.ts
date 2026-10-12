// The three evaluation forms, from Rachel Cox's questionnaire (vault: Staff Evaluations, "2026-10-11 Rachel evaluation questionnaire").
// Question text is hers, word for word. Ids are stable: an id is what an answer is saved under, so never renumber one.
//
// Rollout rule (Rachel, first cycle): every rating is required, 15 to 20 of the long answers are required (the `req` flag below),
// the rest are optional. A rating of 1 or 2 needs an example. 0 means Not Observed.
//
// No question asks about marital status, children, tithing or church attendance. Rachel dropped them from the old form.

export type QKind = 'rating' | 'text' | 'choice' | 'auto';

export interface Question {
  id: string;
  /** Her number for the question. Section 1 fields carry none on Form A. */
  n?: number;
  kind: QKind;
  text: string;
  /** Long answers only: required in the first rollout. Ratings are always required. */
  req?: boolean;
  options?: string[];
  /** auto: filled in by the hub (name, title, department, supervisor, period, date). */
  auto?: 'name' | 'title' | 'department' | 'supervisor' | 'period' | 'date' | 'employee' | 'reviewer';
}

export interface Section {
  id: string;
  title: string;
  blurb?: string;
  /** Short name for the per-category average on the supervisor's page. Ratings sections only. */
  category?: string;
  questions: Question[];
}

export interface Form {
  id: 'A' | 'B' | 'C';
  title: string;
  who: string;
  intro: string[];
  /** Exactly who can read what is written on this form. Rachel: never promise anonymity the process does not give. */
  readers: string;
  sections: Section[];
}

export const SCALE: Array<{ value: number; short: string; label: string; text: string }> = [
  { value: 5, short: '5', label: 'Exceptional', text: 'Consistently exceeds expectations and demonstrates excellence.' },
  { value: 4, short: '4', label: 'Strong', text: 'Consistently meets expectations and frequently goes above them.' },
  { value: 3, short: '3', label: 'Meets Expectations', text: 'Reliably fulfills responsibilities and expectations.' },
  { value: 2, short: '2', label: 'Developing', text: 'Demonstrates potential but needs improvement or greater consistency.' },
  { value: 1, short: '1', label: 'Needs Significant Improvement', text: 'Consistently falls below established expectations.' },
  { value: 0, short: 'N/O', label: 'Not Observed', text: 'Not enough direct experience to evaluate.' },
];

export const EXAMPLE_NOTE = 'A specific example is required for a 1 or 2.';

export const RELATIONSHIPS = ['Immediate Supervisor', 'Department Leader', 'Colleague / Peer', 'Direct Report', 'Cross-Department Collaborator', 'Other'];
export const FREQUENCIES = ['Daily', 'Weekly', 'Monthly', 'Occasionally'];

const r = (id: string, n: number, text: string): Question => ({ id, n, kind: 'rating', text });
const t = (id: string, n: number, text: string, req = false): Question => ({ id, n, kind: 'text', text, req });

export const FORM_A: Form = {
  id: 'A',
  title: 'Employee Self-Assessment',
  who: 'Form A, written by the employee',
  intro: [
    'At Favor International, our desire is to cultivate a culture of growth, accountability, encouragement, and excellence as we serve the Lord together.',
    'This evaluation is intended to provide an opportunity for meaningful reflection, constructive feedback, and professional development. It is not designed primarily to evaluate compensation or advancement, but rather to help each individual recognize their strengths, identify opportunities for growth, and better understand how they contribute to Favor\'s mission.',
    'Please answer each question thoughtfully and honestly. When possible, provide specific examples that demonstrate your experiences, accomplishments, challenges, and areas where additional support or development may be beneficial.',
  ],
  readers: 'You, your supervisor, HR and the hub administrators can read this self-assessment. Nobody else can. It is not shared in Chat, search or Favor Brain.',
  sections: [
    {
      id: 'a-info',
      title: 'Employee Information',
      questions: [
        { id: 'a-name', kind: 'auto', auto: 'name', text: 'Full Name' },
        { id: 'a-title', kind: 'auto', auto: 'title', text: 'Job Title' },
        { id: 'a-dept', kind: 'auto', auto: 'department', text: 'Department' },
        { id: 'a-sup', kind: 'auto', auto: 'supervisor', text: 'Immediate Supervisor' },
        { id: 'a-period', kind: 'auto', auto: 'period', text: 'Evaluation Period' },
        { id: 'a-date', kind: 'auto', auto: 'date', text: 'Date Completed' },
      ],
    },
    {
      id: 'a-job',
      title: 'Job Performance and Accountability',
      blurb: 'Knowledge, execution, productivity, quality, organization, initiative, accountability.',
      category: 'Job performance',
      questions: [
        r('a1', 1, 'I understand my role, responsibilities, and the expectations outlined in my RR&E.'),
        r('a2', 2, 'I consistently follow through on commitments and complete assigned responsibilities.'),
        r('a3', 3, 'I produce accurate, thorough, and high-quality work.'),
        r('a4', 4, 'I effectively prioritize responsibilities and manage competing deadlines.'),
        r('a5', 5, 'I take ownership of my work and accept accountability for outcomes.'),
        r('a6', 6, 'I demonstrate initiative and identify needs without always requiring direction.'),
        r('a7', 7, 'I identify problems and actively contribute practical solutions.'),
        r('a8', 8, 'I adapt effectively to changes in priorities, processes, or organizational needs.'),
        r('a9', 9, 'I look for opportunities to improve existing systems, procedures, and workflows.'),
        r('a10', 10, 'I demonstrate reliability, appropriate availability, and responsible use of work time.'),
        t('a11', 11, 'What are your three most significant accomplishments during this evaluation period?', true),
        t('a12', 12, 'What responsibilities or areas of your role do you believe you perform particularly well? Please provide examples.', true),
        t('a13', 13, 'What challenges have you encountered, and how did you work through them?', true),
        t('a14', 14, 'Describe a situation where you took initiative or identified an opportunity to improve a process.'),
        t('a15', 15, 'Are there areas of your RR&E that need greater clarity, additional training, or adjustment?'),
        t('a16', 16, 'What could you improve about how you manage your workload, responsibilities, or priorities?'),
      ],
    },
    {
      id: 'a-rel',
      title: 'Relationships, Teamwork and Christian Character',
      blurb: 'Integrity, biblical values, humility, collaboration, stewardship, conflict resolution.',
      category: 'Relationships and character',
      questions: [
        r('a17', 17, 'I demonstrate integrity, honesty, and consistency in my words and actions.'),
        r('a18', 18, 'I treat colleagues, ministry partners, and others with kindness, dignity, and respect.'),
        r('a19', 19, 'I demonstrate humility and a willingness to learn from others.'),
        r('a20', 20, 'I contribute to a positive, supportive, and Christ-centered working environment.'),
        r('a21', 21, 'I work collaboratively with others, including individuals outside my department.'),
        r('a22', 22, 'I handle disagreements and difficult conversations respectfully and constructively.'),
        r('a23', 23, 'I am receptive to constructive feedback and make efforts to apply it.'),
        r('a24', 24, 'I demonstrate good stewardship of organizational time, funds, equipment, and resources.'),
        r('a25', 25, 'I seek opportunities to encourage, assist, and support others.'),
        r('a26', 26, 'I demonstrate professionalism and appropriate boundaries in workplace relationships.'),
        t('a27', 27, 'How have you contributed to strengthening relationships and teamwork within Favor?', true),
        t('a28', 28, 'Describe a time when you supported a colleague or another department beyond your normal responsibilities.'),
        t('a29', 29, 'How do you seek to reflect Christ in your daily work, communication, and interactions with others?', true),
        t('a30', 30, 'Describe a situation where you received feedback or experienced a disagreement. How did you respond, and what did you learn?', true),
        t('a31', 31, 'What is one area of personal character or interpersonal growth you would like to develop further?'),
      ],
    },
    {
      id: 'a-comm',
      title: 'Communication and Professional Skills',
      category: 'Communication and skills',
      questions: [
        r('a32', 32, 'I communicate clearly, professionally, and respectfully.'),
        r('a33', 33, 'I provide timely updates and keep appropriate individuals informed.'),
        r('a34', 34, 'I listen attentively and seek to understand others before responding.'),
        r('a35', 35, 'I communicate concerns, challenges, and potential delays proactively.'),
        r('a36', 36, 'I demonstrate sound judgment and thoughtful decision-making.'),
        r('a37', 37, 'I communicate effectively across departments and levels of leadership.'),
        r('a38', 38, 'I participate constructively in meetings and collaborative discussions.'),
        r('a39', 39, 'I appropriately manage confidential or sensitive information.'),
        r('a40', 40, 'I demonstrate a willingness to learn and develop new professional skills.'),
        r('a41', 41, 'I communicate expectations, responsibilities, and next steps clearly when collaborating with others.'),
        t('a42', 42, 'What communication skills do you believe are among your greatest strengths?', true),
        t('a43', 43, 'Where could your communication, responsiveness, or collaboration improve?', true),
        t('a44', 44, 'Describe a situation where effective communication helped resolve a problem or achieve a positive outcome.'),
        t('a45', 45, 'Are there tools, systems, or professional skills you would benefit from additional training in?', true),
      ],
    },
    {
      id: 'a-lead',
      title: 'Leadership and Personal Responsibility',
      blurb: 'Applies to every employee.',
      category: 'Leadership',
      questions: [
        r('a46', 46, 'I lead by example through my actions, attitude, and work ethic.'),
        r('a47', 47, 'I take responsibility for mistakes and actively seek to learn from them.'),
        r('a48', 48, 'I demonstrate a servant-hearted approach to my work and interactions.'),
        r('a49', 49, 'I encourage others and contribute to their success.'),
        r('a50', 50, 'I demonstrate good judgment when making decisions or recommendations.'),
        r('a51', 51, 'I remain professional and constructive during difficult or stressful situations.'),
        r('a52', 52, 'I actively seek opportunities for personal and professional growth.'),
        r('a53', 53, 'I understand how my individual responsibilities support Favor\'s overall mission.'),
        t('a54', 54, 'What does effective Christian leadership look like in your current role?', true),
        t('a55', 55, 'Describe a time when you demonstrated leadership, even if you were not in a formal leadership position.'),
        t('a56', 56, 'What leadership qualities or professional characteristics would you like to strengthen?', true),
        t('a57', 57, 'How can Favor better equip you to take ownership, grow professionally, and contribute to the ministry?'),
      ],
    },
    {
      id: 'a-dev',
      title: 'Professional Development and Future Goals',
      questions: [
        t('a58', 58, 'What professional skills or knowledge have you developed during this evaluation period?'),
        t('a59', 59, 'What training, mentoring, or development opportunities have been most beneficial?'),
        t('a60', 60, 'What are your top three professional development goals for the next six months?', true),
        t('a61', 61, 'What steps will you take to accomplish these goals?', true),
        t('a62', 62, 'What support, resources, or training would help you accomplish them?'),
        t('a63', 63, 'Are there additional responsibilities or areas of the ministry you would like to learn more about?'),
        t('a64', 64, 'What would you like to accomplish professionally over the next 1 to 3 years?'),
        t('a65', 65, 'What opportunities for growth or development would you like to discuss with your supervisor?', true),
      ],
    },
    {
      id: 'a-overall',
      title: 'Overall Reflection and Organizational Feedback',
      questions: [
        t('a66', 66, 'What are you most proud of accomplishing during this evaluation period?', true),
        t('a67', 67, 'What is the most important lesson you have learned?'),
        t('a68', 68, 'What is one thing you would approach differently if given the opportunity?'),
        t('a69', 69, 'Do you feel you have the tools, resources, communication, and leadership support necessary to perform your role effectively? Please explain.', true),
        t('a70', 70, 'What is working well within your department?'),
        t('a71', 71, 'What could be improved within your department or across Favor?'),
        t('a72', 72, 'How could leadership better support you in your role and professional development?'),
        t('a73', 73, 'What would you like your supervisor to understand about your experience during this evaluation period?', true),
        t('a74', 74, 'Is there anything else you would like to share during your evaluation?'),
      ],
    },
  ],
};

export const FORM_B: Form = {
  id: 'B',
  title: 'Peer, Supervisor and Leadership Feedback',
  who: 'Form B, written by each person the employee names',
  intro: [
    'Thank you for helping a colleague grow. Please answer from what you have seen yourself, and give a specific example when you can.',
    'Comments on observable behavior and examples help most. Your supervisor and the employee will read the themes, so write what you would be willing to say face to face.',
  ],
  readers: 'This is not anonymous. The employee\'s supervisor, HR and the hub administrators read your answers with your name on them. The employee does not see your answers word for word. Their supervisor summarizes the themes for them. Nobody else can read what you write.',
  sections: [
    {
      id: 'b-info',
      title: 'About this feedback',
      questions: [
        { id: 'b1', n: 1, kind: 'auto', auto: 'employee', text: 'Name of the employee' },
        { id: 'b2', n: 2, kind: 'auto', auto: 'reviewer', text: 'Your name' },
        { id: 'b3', n: 3, kind: 'choice', text: 'Your working relationship with this employee', options: RELATIONSHIPS },
        { id: 'b4', n: 4, kind: 'choice', text: 'How often you work together', options: FREQUENCIES },
      ],
    },
    {
      id: 'b-job',
      title: 'Job Performance and Accountability',
      category: 'Job performance',
      questions: [
        r('b5', 5, 'Demonstrates a clear understanding of their responsibilities.'),
        r('b6', 6, 'Consistently follows through on commitments and deadlines.'),
        r('b7', 7, 'Produces high-quality, accurate, and reliable work.'),
        r('b8', 8, 'Takes ownership of responsibilities and outcomes.'),
        r('b9', 9, 'Demonstrates initiative and works independently when appropriate.'),
        r('b10', 10, 'Approaches problems constructively and identifies practical solutions.'),
        r('b11', 11, 'Adapts effectively to changing circumstances and priorities.'),
        r('b12', 12, 'Demonstrates effective organization and time management.'),
        t('b13', 13, 'What do you consider this employee\'s greatest professional strengths?', true),
        t('b14', 14, 'Can you share a specific example of this employee demonstrating initiative, accountability, or excellence?'),
        t('b15', 15, 'In what areas could this employee improve their performance or effectiveness?', true),
      ],
    },
    {
      id: 'b-rel',
      title: 'Relationships and Christian Character',
      category: 'Relationships and character',
      questions: [
        r('b16', 16, 'Demonstrates honesty, integrity, and trustworthiness.'),
        r('b17', 17, 'Treats others with kindness, dignity, and respect.'),
        r('b18', 18, 'Demonstrates humility and a willingness to learn.'),
        r('b19', 19, 'Contributes positively to the work environment.'),
        r('b20', 20, 'Works collaboratively and supports team members.'),
        r('b21', 21, 'Handles disagreements or difficult situations respectfully.'),
        r('b22', 22, 'Receives constructive feedback with openness.'),
        r('b23', 23, 'Demonstrates a servant-hearted attitude toward others.'),
        t('b24', 24, 'How does this employee positively contribute to team relationships and Favor\'s working environment?', true),
        t('b25', 25, 'Describe an example of this employee demonstrating Christian character, encouragement, or servant leadership.'),
        t('b26', 26, 'Are there any interpersonal or teamwork-related areas where this employee could grow?', true),
      ],
    },
    {
      id: 'b-comm',
      title: 'Communication and Professional Skills',
      category: 'Communication and skills',
      questions: [
        r('b27', 27, 'Communicates clearly and professionally.'),
        r('b28', 28, 'Keeps appropriate individuals informed of progress, challenges, and updates.'),
        r('b29', 29, 'Demonstrates active listening and consideration for others.'),
        r('b30', 30, 'Responds to communication in an appropriate and timely manner.'),
        r('b31', 31, 'Communicates effectively across departments.'),
        r('b32', 32, 'Demonstrates good judgment and discretion.'),
        r('b33', 33, 'Contributes constructively to meetings and collaborative discussions.'),
        t('b34', 34, 'What communication strengths have you observed in this employee?'),
        t('b35', 35, 'What changes could help this employee communicate or collaborate more effectively?', true),
      ],
    },
    {
      id: 'b-lead',
      title: 'Leadership and Professional Growth',
      category: 'Leadership',
      questions: [
        r('b36', 36, 'Leads by example through attitude, work ethic, and conduct.'),
        r('b37', 37, 'Demonstrates responsibility and accountability.'),
        r('b38', 38, 'Encourages and supports the success of others.'),
        r('b39', 39, 'Responds constructively to challenges or setbacks.'),
        r('b40', 40, 'Demonstrates a willingness to learn and improve.'),
        r('b41', 41, 'Contributes to the overall mission and values of Favor.'),
        t('b42', 42, 'What leadership qualities or positive influences have you observed in this employee?'),
        t('b43', 43, 'What opportunities for growth or development would you recommend?', true),
        t('b44', 44, 'What additional responsibilities, training, or mentorship might benefit this employee?'),
      ],
    },
    {
      id: 'b-overall',
      title: 'Overall Feedback',
      questions: [
        t('b45', 45, 'What are the three greatest strengths this employee brings to Favor?', true),
        t('b46', 46, 'What is one area where you believe this employee has grown during the evaluation period?'),
        t('b47', 47, 'What is one area you would encourage this employee to focus on over the next six months?', true),
        t('b48', 48, 'What is something this employee does that positively impacts your work or the ministry?'),
        t('b49', 49, 'Is there anything this employee could do differently to better support their team, department, or the organization?'),
        t('b50', 50, 'Is there any additional feedback, encouragement, or recommendation you would like to share?'),
      ],
    },
  ],
};

export const PLAN_AREAS = ['Professional Skills', 'Communication and Teamwork', 'Leadership and Character', 'Role-Specific Development'];

const c = (id: string, n: number, text: string): Question => ({ id, n, kind: 'text', text, req: true });

export const FORM_C: Form = {
  id: 'C',
  title: 'Supervisor Evaluation and Development Summary',
  who: 'Form C, written by the supervisor',
  intro: [
    'Review the self-assessment and the feedback side by side. The averages compare how the employee rates each competency with how the others rate it. There is no single overall score.',
    'Write for the employee. After you share this, the employee reads it and the development plan, and it is the only account of the feedback they receive.',
  ],
  readers: 'The employee reads this summary and the plan once you share them. HR and the hub administrators can read it. The raw feedback from each reviewer stays with you, HR and the hub administrators and is never shown to the employee.',
  sections: [
    {
      id: 'c-summary',
      title: 'Supervisor Evaluation',
      questions: [
        c('c1', 1, 'Most significant accomplishments'),
        c('c2', 2, 'Strengths consistently identified across the self-assessment and feedback'),
        c('c3', 3, 'Where self-perception aligned with feedback'),
        c('c4', 4, 'Significant differences between the self-assessment and others\' observations'),
        c('c5', 5, 'Areas of growth consistently identified'),
        c('c6', 6, 'How effectively the employee fulfills the RR&E'),
        c('c7', 7, 'Responsibilities, expectations or reporting relationships needing clarification'),
        c('c8', 8, 'Professional development to prioritize'),
        c('c9', 9, 'Support or resources the supervisor or organization should provide'),
        c('c10', 10, 'Measurable goals for the next six months'),
      ],
    },
  ],
};

export const FORMS = { A: FORM_A, B: FORM_B, C: FORM_C } as const;

export const PLAN_COLUMNS = ['Development area', 'Goal', 'Action steps', 'Support needed', 'Target date'];

/** Every question of a form, in order. */
export function questionsOf(form: Form): Question[] {
  return form.sections.flatMap((s) => s.questions);
}

export function answerable(form: Form): Question[] {
  return questionsOf(form).filter((q) => q.kind !== 'auto');
}

/**
 * Competencies compared on the supervisor's page: the self-assessment questions (A) against the feedback questions (B) that ask
 * the same thing in other words. Others-only and self-only lines stay in their category average.
 */
export interface Competency {
  id: string;
  label: string;
  category: string;
  a: string[];
  b: string[];
}

export const COMPETENCIES: Competency[] = [
  { id: 'role', label: 'Understands the role', category: 'Job performance', a: ['a1'], b: ['b5'] },
  { id: 'follow', label: 'Follows through', category: 'Job performance', a: ['a2'], b: ['b6'] },
  { id: 'quality', label: 'Quality of work', category: 'Job performance', a: ['a3'], b: ['b7'] },
  { id: 'own', label: 'Takes ownership', category: 'Job performance', a: ['a5'], b: ['b8'] },
  { id: 'init', label: 'Initiative', category: 'Job performance', a: ['a6'], b: ['b9'] },
  { id: 'solve', label: 'Solves problems', category: 'Job performance', a: ['a7'], b: ['b10'] },
  { id: 'adapt', label: 'Adapts to change', category: 'Job performance', a: ['a8'], b: ['b11'] },
  { id: 'org', label: 'Organization and time', category: 'Job performance', a: ['a4', 'a10'], b: ['b12'] },
  { id: 'integrity', label: 'Integrity', category: 'Relationships and character', a: ['a17'], b: ['b16'] },
  { id: 'respect', label: 'Respect for others', category: 'Relationships and character', a: ['a18'], b: ['b17'] },
  { id: 'humble', label: 'Humility', category: 'Relationships and character', a: ['a19'], b: ['b18'] },
  { id: 'env', label: 'Positive work environment', category: 'Relationships and character', a: ['a20'], b: ['b19'] },
  { id: 'collab', label: 'Collaboration', category: 'Relationships and character', a: ['a21', 'a25'], b: ['b20'] },
  { id: 'conflict', label: 'Difficult conversations', category: 'Relationships and character', a: ['a22'], b: ['b21'] },
  { id: 'feedback', label: 'Receives feedback', category: 'Relationships and character', a: ['a23'], b: ['b22'] },
  { id: 'servant', label: 'Servant heart', category: 'Relationships and character', a: ['a48'], b: ['b23'] },
  { id: 'clear', label: 'Clear communication', category: 'Communication and skills', a: ['a32', 'a41'], b: ['b27'] },
  { id: 'informed', label: 'Keeps people informed', category: 'Communication and skills', a: ['a33', 'a35'], b: ['b28'] },
  { id: 'listen', label: 'Listening', category: 'Communication and skills', a: ['a34'], b: ['b29'] },
  { id: 'respond', label: 'Responsiveness', category: 'Communication and skills', a: [], b: ['b30'] },
  { id: 'cross', label: 'Across departments', category: 'Communication and skills', a: ['a37'], b: ['b31'] },
  { id: 'judgment', label: 'Judgment and discretion', category: 'Communication and skills', a: ['a36', 'a39'], b: ['b32'] },
  { id: 'meetings', label: 'Meetings', category: 'Communication and skills', a: ['a38'], b: ['b33'] },
  { id: 'example', label: 'Leads by example', category: 'Leadership', a: ['a46'], b: ['b36'] },
  { id: 'resp', label: 'Responsibility', category: 'Leadership', a: ['a47'], b: ['b37'] },
  { id: 'encourage', label: 'Encourages others', category: 'Leadership', a: ['a49'], b: ['b38'] },
  { id: 'steady', label: 'Steady under pressure', category: 'Leadership', a: ['a51'], b: ['b39'] },
  { id: 'learn', label: 'Willing to learn', category: 'Leadership', a: ['a40', 'a52'], b: ['b40'] },
  { id: 'mission', label: 'Serves the mission', category: 'Leadership', a: ['a53'], b: ['b41'] },
];

export const CATEGORIES = ['Job performance', 'Relationships and character', 'Communication and skills', 'Leadership'];

/** Rating questions that no competency pairs up (for example "I look for opportunities to improve existing systems"). They still count in the category average. */
export function categoryOf(qid: string): string {
  for (const f of [FORM_A, FORM_B]) {
    for (const s of f.sections) {
      if (s.category && s.questions.some((q) => q.id === qid)) return s.category;
    }
  }
  return '';
}

/** The long answers required in the first rollout, by form. */
export function requiredText(form: Form): Question[] {
  return questionsOf(form).filter((q) => q.kind === 'text' && q.req);
}
