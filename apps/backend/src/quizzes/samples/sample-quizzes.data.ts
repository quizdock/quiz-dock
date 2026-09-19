import type { QuestionContent } from '../../questions/dto/question-content.schema';
import type { SlideContent } from '../../slides/dto/slide-content.schema';

/**
 * Sample quiz definition. Questions are expressed with the same schema as the API
 * (`questionContentSchema`), so the spec can validate them like a client payload.
 */
export interface SampleQuiz {
  title: string;
  description: string;
  language: string;
  /** Intro slide, shown before the first question. */
  intro: SlideContent;
  questions: QuestionContent[];
}

const q = (input: Partial<QuestionContent> & Pick<QuestionContent, 'type' | 'prompt'>) =>
  ({
    timeLimitS: 20,
    pointsMode: 'standard',
    textTone: 'light',
    textOutline: true,
    options: [],
    acceptedAnswers: [],
    ...input,
  }) as QuestionContent;

const opt = (
  text: string,
  color: QuestionContent['options'][number]['color'],
  shape: QuestionContent['options'][number]['shape'],
  extra: Partial<QuestionContent['options'][number]> = {},
) => ({ text, color, shape, isCorrect: false, ...extra });

const A = (text: string, isCorrect = false) => opt(text, 'red', 'triangle', { isCorrect });
const B = (text: string, isCorrect = false) => opt(text, 'blue', 'diamond', { isCorrect });
const C = (text: string, isCorrect = false) => opt(text, 'yellow', 'circle', { isCorrect });
const D = (text: string, isCorrect = false) => opt(text, 'green', 'square', { isCorrect });

const intro = (heading: string, md: string, colors: string[]): SlideContent => ({
  blocks: [
    { type: 'heading', id: 'intro-title', text: heading, level: 1, align: 'center' },
    { type: 'text', id: 'intro-text', md, align: 'center', size: 'large' },
  ],
  gradient: { angle: 135, colors },
  textTone: 'light',
  textOutline: true,
  displayDelayS: 8,
});

export const SAMPLE_QUIZZES: SampleQuiz[] = [
  {
    title: 'Discover France',
    description: 'Sample quiz — geography, history and culture of France.',
    language: 'en',
    intro: intro(
      'Discover France',
      'Ten quick questions about *l’Hexagone* — from the Alps to the Atlantic.',
      ['#1d3fa0', '#f5f5f5', '#d02a2a'],
    ),
    questions: [
      q({
        type: 'single_choice',
        prompt: 'What is the capital of France?',
        options: [A('Lyon'), B('Paris', true), C('Marseille'), D('Bordeaux')],
        answerExplanation: 'Paris has been the capital since the late 10th century.',
      }),
      q({
        type: 'true_false',
        prompt: 'France shares a land border with Spain.',
        options: [A('True', true), B('False')],
        answerExplanation: 'The Pyrenees form the border between the two countries.',
        timeLimitS: 10,
      }),
      q({
        type: 'multiple_choice',
        prompt: 'Which of these rivers flow through France?',
        options: [A('Loire', true), B('Danube'), C('Seine', true), D('Rhône', true)],
        answerExplanation: 'The Danube rises in Germany and never enters France.',
      }),
      q({
        type: 'numeric',
        prompt: 'How tall is the Eiffel Tower, in metres (to the nearest 10)?',
        numericValue: 330,
        numericTolerance: 10,
        answerExplanation: 'It stands at about 330 m including its antennas.',
        timeLimitS: 30,
      }),
      q({
        type: 'text_input',
        prompt: 'Which French city is famous for its annual film festival?',
        acceptedAnswers: [{ text: 'Cannes' }],
        answerExplanation: 'The Cannes Film Festival has been held since 1946.',
      }),
      q({
        type: 'single_choice',
        prompt: 'In which year did the French Revolution begin?',
        options: [A('1776'), B('1789', true), C('1804'), D('1815')],
        answerExplanation: 'The storming of the Bastille took place on 14 July 1789.',
      }),
      q({
        type: 'ordering',
        prompt: 'Order these French cities from north to south.',
        options: [
          opt('Marseille', 'red', 'triangle', { correctOrderIndex: 3 }),
          opt('Lille', 'blue', 'diamond', { correctOrderIndex: 0 }),
          opt('Lyon', 'yellow', 'circle', { correctOrderIndex: 2 }),
          opt('Paris', 'green', 'square', { correctOrderIndex: 1 }),
        ],
        timeLimitS: 30,
      }),
      q({
        type: 'single_choice',
        prompt: 'Which cheese is traditionally made in the Jura mountains?',
        options: [A('Camembert'), B('Roquefort'), C('Comté', true), D('Brie')],
        pointsMode: 'double',
        answerExplanation: 'Comté is an aged cow’s-milk cheese from the Jura Massif.',
      }),
      q({
        type: 'true_false',
        prompt: 'The Tour de France has been raced every single year since 1903.',
        options: [A('True'), B('False', true)],
        answerExplanation: 'It was suspended during both World Wars.',
        timeLimitS: 10,
      }),
      q({
        type: 'poll',
        prompt: 'Which French region would you visit first?',
        options: [A('Brittany'), B('Provence'), C('Alsace'), D('The Alps')],
        timeLimitS: 15,
      }),
    ],
  },
  {
    title: 'Discover Taiwan',
    description: 'Sample quiz — geography, history and culture of Taiwan.',
    language: 'en',
    intro: intro(
      'Discover Taiwan',
      'Ten quick questions about *Formosa* — from Taipei 101 to Taroko Gorge.',
      ['#0b7a3b', '#f5f5f5', '#d02a2a'],
    ),
    questions: [
      q({
        type: 'single_choice',
        prompt: 'What is the capital of Taiwan?',
        options: [A('Kaohsiung'), B('Taichung'), C('Taipei', true), D('Tainan')],
        answerExplanation: 'Taipei, in the north of the island, is the seat of government.',
      }),
      q({
        type: 'true_false',
        prompt: 'Taiwan is crossed by the Tropic of Cancer.',
        options: [A('True', true), B('False')],
        answerExplanation: 'The Tropic of Cancer runs through Chiayi and Hualien counties.',
        timeLimitS: 10,
      }),
      q({
        type: 'numeric',
        prompt: 'How many floors does Taipei 101 have?',
        numericValue: 101,
        numericTolerance: 0,
        answerExplanation: 'The name says it all — 101 floors above ground.',
        timeLimitS: 15,
      }),
      q({
        type: 'multiple_choice',
        prompt: 'Which of these are popular Taiwanese night-market foods?',
        options: [
          A('Stinky tofu', true),
          B('Bubble tea', true),
          C('Oyster omelette', true),
          D('Croissant'),
        ],
        answerExplanation: 'Bubble tea was invented in Taiwan in the 1980s.',
      }),
      q({
        type: 'text_input',
        prompt: 'Which marble-walled gorge is Taiwan’s most famous national park?',
        acceptedAnswers: [{ text: 'Taroko' }, { text: 'Taroko Gorge' }],
        answerExplanation: 'Taroko National Park lies on the east coast, near Hualien.',
      }),
      q({
        type: 'single_choice',
        prompt: 'What is the highest mountain in Taiwan?',
        options: [A('Yushan (Jade Mountain)', true), B('Alishan'), C('Xueshan'), D('Hehuanshan')],
        answerExplanation:
          'Yushan reaches 3,952 m — the highest peak in East Asia outside the Himalayas.',
      }),
      q({
        type: 'ordering',
        prompt: 'Order these Taiwanese cities from north to south.',
        options: [
          opt('Kaohsiung', 'red', 'triangle', { correctOrderIndex: 3 }),
          opt('Taipei', 'blue', 'diamond', { correctOrderIndex: 0 }),
          opt('Tainan', 'yellow', 'circle', { correctOrderIndex: 2 }),
          opt('Taichung', 'green', 'square', { correctOrderIndex: 1 }),
        ],
        timeLimitS: 30,
      }),
      q({
        type: 'single_choice',
        prompt: 'Which language is the most widely spoken in Taiwan?',
        options: [A('Japanese'), B('Mandarin Chinese', true), C('Cantonese'), D('Hokkien')],
        pointsMode: 'double',
        answerExplanation:
          'Mandarin is the official language; Taiwanese Hokkien is the second most spoken.',
      }),
      q({
        type: 'true_false',
        prompt: 'Taiwan was a Japanese colony for fifty years, from 1895 to 1945.',
        options: [A('True', true), B('False')],
        answerExplanation: 'Japanese rule began with the Treaty of Shimonoseki (1895).',
        timeLimitS: 10,
      }),
      q({
        type: 'poll',
        prompt: 'Which Taiwanese experience would you pick?',
        options: [A('Night market'), B('Hot springs'), C('Hiking Yushan'), D('Sun Moon Lake')],
        timeLimitS: 15,
      }),
    ],
  },
];
