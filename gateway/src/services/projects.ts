/**
 * AuthorClaw Project Engine — V4
 * Autonomous book production at scale
 *
 * 6 Core Project Types (chainable into a Pipeline):
 *   book-planning    - Market analysis → premise → characters → outline → synopsis
 *   book-bible       - World-building → character bible → continuity → style guide
 *   book-production  - Write chapters sequentially with context injection
 *   deep-revision    - 21-step, 3-pass revision (macro → medium → micro + beta readers)
 *   format-export    - Front/back matter → DOCX/EPUB/PDF export (KDP-ready)
 *   book-launch      - Blurb → Amazon desc → keywords → ad copy → social posts
 *
 * Pipeline Mode: Chain all 6 phases from a single idea + persona
 */

import { AuthorOSService } from './author-os.js';
import type { SkillCatalogEntry } from '../skills/loader.js';
import { readFile } from 'fs/promises';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

// ═══════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════

/**
 * Callback type for AI completion — injected by the gateway so ProjectEngine
 * can call the AI without importing the router directly.
 */
export type AICompleteFunc = (request: {
  provider: string;
  system: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  maxTokens?: number;
  temperature?: number;
}) => Promise<{ text: string; tokensUsed: number; estimatedCost: number; provider: string }>;

/**
 * Callback to select the best provider for a task type
 */
export type AISelectProviderFunc = (taskType: string) => { id: string };

export type ProjectType =
  | 'book-planning'
  | 'book-bible'
  | 'book-production'
  | 'deep-revision'
  | 'format-export'
  | 'book-launch'
  | 'keyword-book-mvp'
  | 'novel-pipeline'
  | 'pipeline'
  | 'custom';

export interface Project {
  id: string;
  type: ProjectType;
  title: string;
  description: string;
  status: 'pending' | 'active' | 'paused' | 'completed' | 'failed';
  progress: number; // 0-100
  steps: ProjectStep[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  context: Record<string, any>;
  personaId?: string;     // Author persona assigned to this project
  preferredProvider?: string; // Override AI provider: 'gemini' | 'claude' | 'openai' | 'deepseek' | 'ollama' | null (auto)
  pipelineId?: string;    // Parent pipeline ID (if part of a pipeline)
  pipelinePhase?: number; // Phase order within pipeline (1-6)
}

export interface ProjectStep {
  id: string;
  label: string;
  skill?: string;         // Matched skill name
  toolSuggestion?: string; // Author OS tool to use
  taskType: string;        // AI router task type (for tier routing)
  prompt: string;          // The prompt to send to AI
  status: 'pending' | 'active' | 'completed' | 'skipped' | 'failed';
  result?: string;
  error?: string;
  // Novel pipeline fields:
  phase?: string;           // 'premise' | 'bible' | 'outline' | 'writing' | 'revision' | 'assembly'
  wordCountTarget?: number; // Target words for this step (triggers multi-pass continuation)
  chapterNumber?: number;   // Chapter number for writing/revision steps
}

export interface NovelPipelineConfig {
  genre?: string;
  pov?: string;
  logline?: string;
  themes?: string;
  setting?: string;
  tone?: string;
  tense?: string;
  targetChapters?: number;        // default 25
  targetWordsPerChapter?: number; // default 4000
  protagonistName?: string;
  antagonistName?: string;
}

export interface KeywordBookCandidate {
  id: string;
  title: string;
  hook: string;
  premise: string;
  audience: string;
  highlights: string[];
}

export interface KeywordBookProjectConfig {
  keyword: string;
  targetWords?: number;
  targetWordsPerChapter?: number;
  selectedCandidate: KeywordBookCandidate;
}

// ═══════════════════════════════════════════════════════════
// Project Templates — Pre-built step sequences per project type
// ═══════════════════════════════════════════════════════════

interface ProjectTemplate {
  type: ProjectType;
  label: string;
  description: string;
  steps: Array<{
    label: string;
    skill?: string;
    toolSuggestion?: string;
    taskType: string;
    promptTemplate: string; // Uses {{title}}, {{description}}, {{genre}}, etc.
  }>;
}

// Valid task types that the AI router understands (for planProject prompt)
const TASK_TYPE_MAP: Record<string, string> = {
  general: '基础任务，聊天，简单问题',
  research: '网络搜索，事实查证',
  creative_writing: '散文写作，章节，场景',
  revision: '编辑，重写，反馈',
  style_analysis: '声音/风格匹配',
  marketing: '简介，推销，广告',
  outline: '故事结构，节拍表',
  book_bible: '世界观构建，角色',
  consistency: '跨章节连贯性分析',
  final_edit: '最终润色，校对',
};

const PROJECT_TEMPLATES: ProjectTemplate[] = [
  // ═══════════════════════════════════════════════════════════
  // Template 1: Book Planning
  // ═══════════════════════════════════════════════════════════
  {
    type: 'book-planning',
    label: '书籍规划',
    description: '市场分析，前提构思，角色设定，章节大纲和剧情梗概',
    steps: [
      {
        label: '市场和受众分析',
        skill: 'research',
        taskType: 'research',
        promptTemplate: `分析这类书籍的当前市场：{{description}}

研究并报告：
1. **类型格局**：该类型/子类型中最畅销的对标作品
2. **读者期望**：该类型需要什么样的桥段、套路和节奏？
3. **市场空白**：什么题材被忽视了？机会在哪里？
4. **对标作品**：找出3-5本对标作品，并说明它们为什么相关
5. **目标受众**：人口统计、阅读习惯、他们从哪里发现新书
6. **商业可行性**：对市场潜力的客观评估

请具体且具有可操作性，这将指导后续的所有决策。`,
      },
      {
        label: '开发核心前提',
        skill: 'premise',
        taskType: 'general',
        promptTemplate: `为以下内容开发一个具有商业可行性的核心前提：{{description}}

利用市场分析结果，创建：
1. **一句话简介 (Logline)**：1-2句话推销这本书
2. **“如果...会怎样” (What-If) 问题**：核心吸引力
3. **核心冲突**：内在和外在冲突
4. **赌注 (Stakes)**：如果主角失败了会发生什么？（个人的，职业的，全球的）
5. **主题声明 (Theme statement)**：这本书关于生活的深层论点
6. **独特的钩子 (Unique hook)**：是什么让这本书从对标作品中脱颖而出？
7. **类型承诺 (Genre promise)**：我们提供什么样的情感体验？

使这个前提在商业上引人入胜，并在创造性上令人兴奋。`,
      },
      {
        label: '核心人物设定',
        skill: 'book-bible',
        taskType: 'book_bible',
        promptTemplate: `为以下内容创建详细的人物档案：{{description}}

构建：
**主角**：全名，年龄，背景故事，动机（想要与需要），致命缺陷，情感创伤，优势，外貌，言语模式，角色弧光
**对手**：动机，背景故事，他们为什么认为自己是对的，他们如何挑战主角
**3-4个配角**：名字，角色，与主角的关系，他们如何推动/挑战角色的弧光

每个角色都应该感觉真实——有矛盾，有欲望，有恐惧。总共写800字以上。`,
      },
      {
        label: '逐章大纲',
        skill: 'outline',
        taskType: 'outline',
        promptTemplate: `为以下内容创建一个详细的逐章大纲：{{description}}

每一章包括：
- **章节号和标题**
- **POV角色**
- **关键节拍**（每章3-5个）
- **转折点**和启示
- **紧张程度**（1-10）
- **章节结尾悬念**

使用三幕结构：
- 第一幕 (25%)：设定，激励事件，辩论/拒绝
- 第二幕A (25%)：上升的行动，游戏与娱乐，中点转变
- 第二幕B (25%)：复杂化，一败涂地时刻
- 第三幕 (25%)：高潮序列，结局

目标20-30章。为每一章编号。`,
      },
      {
        label: '剧情梗概生成',
        skill: 'outline',
        taskType: 'general',
        promptTemplate: `为以下内容生成专业的剧情梗概：{{description}}

创建两个版本：
1. **一页梗概**（约500字）：包含结局的完整故事弧。专业的查询格式。
2. **三页梗概**（约1500字）：扩展角色弧光，关键场景和情感节拍。

两者都应该：
- 揭示整个情节（包括结局——这是为行业专业人士准备的）
- 展示角色的情感旅程
- 表现出清晰的故事结构
- 使用现在时，第三人称书写
- 读起来引人入胜，而不仅仅是尽职尽责`,
      },
      {
        label: '审查与完善计划',
        skill: 'revise',
        taskType: 'revision',
        promptTemplate: `审查我们建立的完整书籍计划。检查：

1. **情节漏洞**：大纲中有逻辑漏洞吗？
2. **角色一致性**：动机和弧光有意义吗？
3. **节奏问题**：大纲中有死区或仓促的部分吗？
4. **主题连贯性**：每个子情节是否强化了主题？
5. **商业可行性**：这符合市场分析的发现吗？
6. **类型合规性**：所有的类型承诺都兑现了吗？

提供具体的改进，而不是模糊的建议。引用章节号和角色名。`,
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════
  // Template 2: Book Bible
  // ═══════════════════════════════════════════════════════════
  {
    type: 'book-bible',
    label: '设定集',
    description: '世界观构建、角色档案、连贯性追踪表、主题和风格参考',
    steps: [
      {
        label: '世界观构建文档',
        skill: 'book-bible',
        taskType: 'book_bible',
        promptTemplate: `为以下内容创建全面的世界观构建文档：{{description}}

包括：
1. **设定**：物理环境，地理，气候，带有感官细节的关键地点
2. **时间段**：这发生在什么时候？历史/未来背景
3. **社会结构**：权力动态，社会阶层，政治制度
4. **规则**：物理/魔法定律，技术，什么是可能的，什么是不可能的
5. **文化**：习俗，信仰，语言，食物，娱乐
6. **历史**：在故事开始前塑造这个世界的关键事件
7. **经济**：人们如何谋生？什么是有价值的？
8. **日常生活**：普通人平凡的一天是什么样的？

写1000字以上。要足够具体，以便作家能够在80000字中保持一致性。`,
      },
      {
        label: '角色档案',
        skill: 'book-bible',
        taskType: 'book_bible',
        promptTemplate: `为以下内容创建深入的角色档案：{{description}}

对于每个主要角色（主角，对手，3-4个配角）：
- **全名**和任何昵称
- **年龄，外貌**（具体：眼睛颜色，头发，身高，显著特征）
- **性格**：迈尔斯-布里格斯类型，九型人格，核心恐惧，核心欲望
- **背景故事**：200字以上的成长经历
- **声音**：言语模式，词汇量，口头禅，句子风格
- **弧光**：他们从哪里开始 → 什么改变了 → 他们在哪里结束
- **人际关系**：用动态描述映射到其他角色
- **秘密**：他们在隐藏什么？瞒着谁？

还要创建一个**关系网**，显示所有角色是如何连接的。`,
      },
      {
        label: '系列连贯性追踪表',
        skill: 'book-bible',
        taskType: 'consistency',
        promptTemplate: `为以下内容创建一个连贯性追踪文档：{{description}}

这是保持一致性的主参考。包括：
1. **角色追踪表**：物理细节，在第X章介绍，状态（生/死/失踪）
2. **时间线**：故事中事件的每日年表
3. **地点细节**：房间布局，地点之间的距离，什么在哪里
4. **物品追踪**：重要物品——谁有它们，它们在哪里
5. **情节线追踪**：每个承诺/设置以及它在哪里解决
6. **名称注册表**：所有专有名词及一致的拼写
7. **规则参考**：世界规则的快速查找（魔法消耗，技术限制等）

格式化为一个作家在写作时可以快速扫描的参考指南。`,
      },
      {
        label: '主题与母题指南',
        skill: 'book-bible',
        taskType: 'book_bible',
        promptTemplate: `为以下内容创建一个主题和母题指南：{{description}}

分析并记录：
1. **中心主题**：这本书对人性/生活提出了什么论点？
2. **支持主题**：2-3个强化中心主题的次要主题
3. **反复出现的母题**：反复出现的图像，物体或情况
4. **象征元素**：什么代表什么？（环境，天气，物体，颜色）
5. **每个子情节的主题**：每个子情节如何探索主题的一个方面
6. **主题弧光**：主题如何在故事结构中发展
7. **母题放置指南**：每个母题应该出现在哪里以获得最大影响

这个指南确保每个场景都服务于书的更深层含义。`,
      },
      {
        label: '风格与基调参考',
        skill: 'style-clone',
        taskType: 'style_analysis',
        promptTemplate: `为以下内容创建一个风格和基调参考指南：{{description}}

记录这本书需要的写作声音：
1. **基调**：黑暗？幽默？抒情？尖锐？温暖？用例子描述
2. **散文风格**：句子长度倾向，词汇水平，节奏
3. **POV方法**：深层POV？全知？离角色的思想有多近？
4. **时态**：过去或现在？为什么？
5. **对话风格**：自然主义？程式化？活泼？正式？
6. **描述方法**：丰富而详细？稀疏而有力？
7. **示例文本**：用目标声音写一段200字的段落
8. **声音禁忌**：写作不应该听起来像什么？

如果分配了作者角色，将他们的声音资料整合到这个指南中。`,
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════
  // Template 3: Book Production (stub — chapters generated dynamically)
  // ═══════════════════════════════════════════════════════════
  {
    type: 'book-production',
    label: '书籍制作',
    description: '按顺序编写章节并注入完整上下文 — 编写、自查并编译',
    steps: [], // Dynamic: chapters auto-generated based on config (like novel-pipeline writing phase)
  },

  // ═══════════════════════════════════════════════════════════
  // Template 4: Deep Revision (21 steps, 3 passes)
  // ═══════════════════════════════════════════════════════════
  {
    type: 'deep-revision',
    label: '深度修订',
    description: '21个步骤，3遍手稿修订 — 宏观（结构），中观（场景级别），微观（行级别）+ 试读小组',
    steps: [
      // ── Pass 1: Macro / Structural (7 steps) ──
      {
        label: '情节结构分析',
        skill: 'revise',
        taskType: 'revision',
        promptTemplate: `分析这部手稿的情节结构：

**手稿**：“{{title}}” — {{description}}

评估：
1. **三幕结构合规性**：是否有清晰的设定、对抗和解决方案？
2. **激励事件**：什么时候发生？够不够强？太早/太晚？
3. **中点转变**：中点是否发生了真正的逆转或启示？
4. **一败涂地时刻**：75%的进度是否带来了真正的绝望？
5. **高潮**：是水到渠成的吗？它解决核心冲突了吗？
6. **结局**：是否令人满意，而又不过于完美？
7. **英雄之旅节拍**：哪些原型存在？哪些缺失？

对结构完整性进行评分：1-10。为每个问题提供具体的章节参考。`,
      },
      {
        label: '节奏审计',
        skill: 'revise',
        taskType: 'revision',
        promptTemplate: `为以下内容创建逐章节奏热图：

**手稿**：“{{title}}” — {{description}}

对于每一章：紧张感 (1-10) | 节奏 (太快/快/好/慢/拖沓) | 场景类型 | 能量

然后分析：
- 能量低谷在哪里？章节应该被删减还是合并？
- 高潮时刻的铺垫是否到位？
- 行动与反思的比例是否平衡？
- 章节长度是否一致？变化是否服务于故事？
- 前3章是否积累了足够的动力？

以影响力排序，给出排名前3的节奏修复建议作为结束。`,
      },
      {
        label: '角色弧光一致性',
        skill: 'revise',
        taskType: 'revision',
        promptTemplate: `检查以下内容中角色弧光的一致性：

**手稿**：“{{title}}” — {{description}}

对于每个主要角色：
1. **弧光映射**：他们从哪里开始 → 关键转折点 → 他们在哪里结束
2. **成长的证据**：哪些具体场景展示了变化？
3. **退步时刻**：挫折可信吗？
4. **弧光完成**：结局兑现了对角色的承诺吗？
5. **动机一致性**：他们是否为了情节的便利而做出不符合性格的行为？

标记任何没有改变，改变太突然或行为不一致的角色。`,
      },
      {
        label: '主题连贯性审查',
        skill: 'revise',
        taskType: 'revision',
        promptTemplate: `分析以下内容的主题连贯性：

**手稿**：“{{title}}” — {{description}}

1. **中心主题识别**：除了情节之外，这本书真正讲述的是什么？
2. **子情节中的主题**：每个子情节是强化还是对比了中心主题？
3. **主题漂移**：是否有部分主题丢失了？
4. **角色弧光中的主题**：每个角色的旅程如何探索主题？
5. **主题解析**：结局是否对主题做出了清晰的陈述？
6. **生硬说教**：是否有主题变得像说教的时刻？`,
      },
      {
        label: '世界观连续性扫描',
        skill: 'revise',
        taskType: 'consistency',
        promptTemplate: `对以下内容运行世界观连续性扫描：

**手稿**：“{{title}}” — {{description}}

检查：
1. **设定矛盾**：房间布局，地理，地点之间的距离
2. **规则违背**：在没有解释的情况下被打破的魔法/技术/社会规则
3. **时间线错误**：天，日期，季节，一天中的时间不一致
4. **角色知识**：有人知道他们不应该知道的事情吗？
5. **死亡/失踪角色**：有人在没有解释的情况下消失了吗？
6. **物品追踪**：重要物品在没有逻辑的情况下出现/消失

对于每个问题：它出现在哪里，矛盾是什么，以及如何修复它。按严重程度组织。`,
      },
      {
        label: '赌注升级验证',
        skill: 'revise',
        taskType: 'revision',
        promptTemplate: `验证以下内容中的赌注是否适当地升级：

**手稿**：“{{title}}” — {{description}}

分析：
1. **个人赌注**：如果主角失败了，他们个人会失去什么？这加深了吗？
2. **外部赌注**：随着故事的发展，后果如何扩大？
3. **紧迫性**：有倒计时吗？时间压力是否增加？
4. **行动成本**：随着故事的进展，追求目标的成本是否更高？
5. **不归路**：主角什么时候再也不能走开了？
6. **高潮时的赌注**：最终的赌注是否达到了最高点？

标记任何赌注停滞，减少或感觉不自然的时刻。`,
      },
      {
        label: '子情节追踪与解析',
        skill: 'revise',
        taskType: 'revision',
        promptTemplate: `追踪以下内容中的所有子情节：

**手稿**：“{{title}}” — {{description}}

对于找到的每个子情节：
1. **介绍**：它是何时以及如何被介绍的？
2. **目的**：它如何服务于主要情节或主题？
3. **关键节拍**：主要发展（带有章节参考）
4. **解析**：它是如何以及何时被解决的？
5. **遗弃的线索**：是否有什么设定了但从未得到回报？

还要检查：
- 任何子情节是多余的吗？两个子情节是否实现了相同的目的？
- 任何子情节是否不发达？
- 子情节是否干扰了节奏？`,
      },

      // ── Pass 2: Medium / Scene-Level (7 steps) ──
      {
        label: '对话真实性检查',
        skill: 'dialogue',
        taskType: 'revision',
        promptTemplate: `对以下内容执行对话真实性审计：

**手稿**：“{{title}}” — {{description}}

1. **声音独特性**：对每个主要角色声音的独特性进行评分（1-10）。你能把他们区分开来吗？
2. **信息倾倒**：标记“如你所知，鲍勃……”的时刻
3. **潜台词质量**：言与意不符的最好和最坏例子
4. **言语模式**：注意每个角色独特的模式
5. **提示语与动作节拍比例**：它们平衡吗？
6. **情感真实性**：情感对话听起来真实吗？

为5段最差的对话提出重写建议。`,
      },
      {
        label: '展示而非讲述审计',
        skill: 'revise',
        taskType: 'revision',
        promptTemplate: `扫描以下内容中“展示与讲述”的问题：

**手稿**：“{{title}}” — {{description}}

标记：情感讲述，角色描述讲述，背景故事倾倒，动机讲述，氛围讲述。

对于10个最严重的问题：引用原文 → 写一个“展示”的重写 → 解释为什么它更强。

注意：一些讲述是没问题的。只标记那些展示会真正改善体验的情况。`,
      },
      {
        label: '场景张力与冲突检查',
        skill: 'revise',
        taskType: 'revision',
        promptTemplate: `检查每个场景的张力和冲突：

**手稿**：“{{title}}” — {{description}}

对于每个场景：
- **目标**：POV（视角）角色在这个场景中想要什么？
- **障碍**：是什么阻止了他们得到它？
- **赌注**：如果他们失败了会发生什么？
- **结果**：他们是成功了，失败了，还是得到了一个复杂的结果？

标记任何出现以下情况的场景：
- 角色没有目标
- 没有对抗
- 到最后什么都没有改变
- 张力纯粹是内在的，没有外部表现

这些场景可能需要被删减或加强。`,
      },
      {
        label: '过渡平滑度审查',
        skill: 'revise',
        taskType: 'revision',
        promptTemplate: `审查以下内容中的所有过渡：

**手稿**：“{{title}}” — {{description}}

检查：
1. **章节过渡**：每章是否以悬念结束并以定位开始？
2. **场景中断**：时间/地点的跳跃清晰吗？
3. **POV转换**：如果是多POV，转换是否平滑且有明确信号？
4. **时间线跳跃**：倒叙/闪前处理得好吗？
5. **基调转换**：基调变化感觉是有意的还是突兀的？

标记5个最生硬的过渡，并提出更平滑的替代方案。`,
      },
      {
        label: '情感节拍映射',
        skill: 'revise',
        taskType: 'revision',
        promptTemplate: `映射以下内容的情感旅程：

**手稿**：“{{title}}” — {{description}}

逐章识别：
- **主导情绪**：读者应该感受到什么？
- **情感高点**：最强烈的时刻
- **情感低点**：最脆弱/悲伤的时刻
- **情感多样性**：每一章是否提供了不同的情感风味？

然后评估：
- 情感变化是否足够，或者感觉单调？
- 强烈的情感时刻是否达到了效果？它们有适当的铺垫吗？
- 情感高潮是书中最强烈的时刻吗？
- 在动作之间是否有足够多安静、亲密的时刻？`,
      },
      {
        label: '感官细节增强',
        skill: 'revise',
        taskType: 'revision',
        promptTemplate: `审计以下内容中的感官细节：

**手稿**：“{{title}}” — {{description}}

1. **感官盘点**：使用了5种感官中的哪几种？哪些使用不足？
2. **视觉过度检查**：写作是否过于视觉化，而声音、气味、触觉、味觉不够？
3. **关键场景**：关键场景是否深深扎根于感官体验中？
4. **设定氛围**：地点有独特的感官特征吗？
5. **角色过滤**：感官细节是否通过POV角色的个性进行了过滤？

识别5-10个最能从感官丰富中受益的场景，并提出具体的细节建议。`,
      },
      {
        label: '信息倾倒与说明检测',
        skill: 'revise',
        taskType: 'revision',
        promptTemplate: `扫描以下内容中的信息倾倒和说明问题：

**手稿**：“{{title}}” — {{description}}

标记每一个实例：
1. **背景故事倾倒**：打断动作的大段历史
2. **世界观讲座**：角色解释读者暂时不需要知道的事情
3. **“如你所知，鲍勃”式对话**：角色互相告诉他们已经知道的事情
4. **镜像描述**：角色在照镜子时描述自己的外貌
5. **序言信息倾倒**：开头是否预先加载了太多上下文？

对于每一个：引用段落，解释为什么它是一个问题，并建议如何自然地将信息编织进去（通过动作、对话潜台词或逐渐揭示）。`,
      },

      // ── Pass 3: 微观/行级修改 (5步) ──
      {
        label: '文字编辑',
        skill: 'revise',
        taskType: 'final_edit',
        promptTemplate: `对以下内容执行文字编辑：

**手稿**：“{{title}}” — {{description}}

检查：
- 语法错误
- 标点符号问题（特别是对话标点）
- 拼写错误
- 同音词错误（如的/地/得，在/再）
- 主谓一致
- 时态一致性
- 逗号连接的独立分句和连写句

列出发现的所有错误，附带章节/位置和修改建议。`,
      },
      {
        label: '行级编辑',
        skill: 'revise',
        taskType: 'final_edit',
        promptTemplate: `对以下内容执行行级编辑：

**手稿**：“{{title}}” — {{description}}

重点关注：
- **行文节奏**：句子长度的多样性、流畅度、韵律感
- **词语选择**：准确性、具体性，避免使用泛泛的词汇
- **动词力度**：用生动的动词替换弱动词（如：是、有、得到）
- **清晰度**：是否有令人困惑的句子或指代不明的地方？
- **冗余**：表达同样意思的重复短语

展示10个行级改进前/后的示例。`,
      },
      {
        label: '重复词查找',
        skill: 'revise',
        taskType: 'revision',
        promptTemplate: `在以下内容中查找过度使用的词语和短语：

**手稿**：“{{title}}” — {{description}}

报告内容：
1. **过度使用的词语**：副词、弱动词、无意义的填充词及其频率
2. **口头禅/套话**：作者经常依赖的重复结构
3. **AI感词汇**：深入探讨、交织、证明、本能的、微妙的、多面的、共鸣、范式、无数的、灯塔、领域
4. **重复的开头**：以相同模式开头的句子
5. **被动语态频率**（目标：<10%）
6. **副词密度**（目标：每千字<5个）

对每个发现提供：词语/短语、频率、示例和建议的替代词。`,
      },
      {
        label: '消除冗词/口头禅',
        skill: 'revise',
        taskType: 'final_edit',
        promptTemplate: `从以下内容中消除冗词/口头禅：

**手稿**：“{{title}}” — {{description}}

具体目标：
- **只是、真的、非常、相当、实际上、基本上、字面上** — 标记每个实例，建议删减哪些
- **突然** — 几乎总是可以删掉，直接展示动作
- **感觉/觉得** — 通常是“讲述”，请展示这种感觉
- **开始** — 直接做动作
- **似乎/看起来** — 更直接一些
- **那个/这** — 标记不必要的实例
- **点头/耸肩/叹气** — 过度使用的身体动作

提供一份按优先级排序的删减列表，并估算节省的字数。`,
      },
      {
        label: '敏感度阅读',
        skill: 'revise',
        taskType: 'revision',
        promptTemplate: `对以下内容进行敏感度阅读：

**手稿**：“{{title}}” — {{description}}

检查：
1. **文化表现**：来自不同背景的角色塑造是否真实？
2. **刻板印象**：是否有角色沦为刻板印象？
3. **语言敏感度**：是否有过时或可能具有冒犯性的用语？
4. **权力动态**：边缘化角色是否被赋予了主观能动性？
5. **历史准确性**：如果设定在真实的时期/地点，文化细节是否准确？
6. **无意识偏见**：在谁是反派、英雄或受害者方面是否存在某种模式？

注意：这只是初步阅读。出版时建议聘请人类敏感度读者。标记出潜在问题以供专业审查。`,
      },

      // ── 最终：试读者 + 总结 ──
      {
        label: '试读者小组',
        skill: 'beta-reader',
        taskType: 'revision',
        promptTemplate: `你们是一个由5名拥有不同视角的试读者组成的小组。阅读并回复：

**手稿**：“{{title}}” — {{description}}

**读者1 — 休闲读者**：直觉反应，哪里让你觉得无聊，喜爱度评分（1-10）
**读者2 — 类型专家**：类型符合度，套路执行情况，市场定位，评分（1-10）
**读者3 — 严厉的批评家**：剧情漏洞，动机薄弱，陈词滥调，最大的单一问题
**读者4 — 目标读者**：情感历程，最喜欢的场景，你会推荐吗？评分（1-10）
**读者5 — 爱情/惊悚狂热粉**：是什么让你继续读下去？是什么让你差点放弃？会预购续集吗？

将每位读者的回复控制在200-300字。具体说明章节出处。`,
      },
      {
        label: '最终修改行动计划',
        skill: 'revise',
        taskType: 'revision',
        promptTemplate: `综合前面所有20次修改，制定最终行动计划：

**手稿**：“{{title}}” — {{description}}

创建：
1. **总体评分**：A-F并附上理由
2. **五大优势**：应该保留和放大的内容
3. **关键修复**（5-7个必做事项，按优先级排序）
4. **重要改进**（5-7个应做事项）
5. **润色项目**（3-5个锦上添花的完善事项）
6. **修改路线图**：第一遍 → 第二遍 → 第三遍的操作顺序
7. **市场准备度**：准备好给试读者看了吗？经纪人？还是自助出版？
8. **鼓励的结语**：是什么让这本书值得完成

使每项建议具体且具有可操作性，并附上章节出处。`,
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════
  // Template 5: Format & Export
  // ═══════════════════════════════════════════════════════════
  {
    type: 'format-export',
    label: '格式与导出',
    description: '生成卷首/卷尾内容并导出为 DOCX、EPUB 和 PDF — KDP 准备就绪的格式',
    steps: [
      {
        label: '生成卷首内容',
        skill: 'format',
        taskType: 'general',
        promptTemplate: `为以下内容生成专业的卷首内容：{{description}}

创建：
1. **扉页**：书名，副标题（如果有），作者名
2. **版权页**：标准的独立出版版权声明，包含年份，保留所有权利，ISBN 占位符，版本信息
3. **致谢/题词**：占位符致谢（作者可以自定义）
4. **目录**：从章节标题自动生成（占位符 — 将在导出期间填充）
5. **题记**（可选）：如果合适，建议一个与主题相关的引用

将每个部分格式化为带有清晰分隔符的干净 markdown。`,
      },
      {
        label: '生成卷尾内容',
        skill: 'format',
        taskType: 'marketing',
        promptTemplate: `为以下内容生成专业的卷尾内容：{{description}}

创建：
1. **作者简介**：专业的第三人称简介（如果可用，使用人物简介，否则创建模板）
2. **作者其他作品**：其他作品列表（如果可用，来自人物的 alsoBy 列表，否则为占位符）
3. **时事通讯号召性用语 (CTA)**：“加入 [作者] 的读者列表，获取独家内容，抢先体验和奖励场景。在 [URL] 注册”
4. **致谢**：包含常见类别的模板（经纪人，编辑，家人，读者）
5. **试读**：下一本书的第一章预告（占位符）

将每个部分格式化为干净的 markdown。保持专业和符合类型的基调。`,
      },
      {
        label: '编译并导出 DOCX',
        skill: 'format',
        taskType: 'general',
        promptTemplate: `将包含卷首和卷尾内容的手稿编译为专业的 DOCX 格式：{{description}}

导出系统将：
- 组合卷首内容 + 章节 + 卷尾内容
- 应用 KDP 标准格式（章节标题，场景分隔，分页）
- 设置专业的排版（衬线字体，两端对齐，适当的页边距）
- 生成可下载的 DOCX 文件

确认手稿已准备好导出。列出章节数，估计字数，以及在出版前应解决的任何缺失部分。`,
      },
      {
        label: '编译并导出 EPUB',
        skill: 'format',
        taskType: 'general',
        promptTemplate: `为以下内容生成 EPUB 导出：{{description}}

导出系统将：
- 创建包含正确元数据（书名，作者，描述）的有效 EPUB3
- 将章节拆分为单独的 XHTML 文件
- 包含封面图像占位符
- 生成导航目录 (TOC)
- 应用干净的阅读 CSS

确认 EPUB 就绪状态。注意任何在电子阅读器上可能渲染不佳的元素。`,
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════
  // Template 6: Book Launch
  // ═══════════════════════════════════════════════════════════
  {
    type: 'book-launch',
    label: '新书发布',
    description: '封底简介，亚马逊描述，关键字，类别，广告文案和社交媒体帖子',
    steps: [
      {
        label: '封底简介',
        skill: 'blurb-writer',
        taskType: 'marketing',
        promptTemplate: `为以下内容撰写引人入胜的书籍简介：{{description}}

创建3个版本：
1. **简短标语**（1句话）：电梯游说
2. **封底简介**（150-200字）：钩子，设定，赌注，问题
3. **长简介**（250-300字）：包含更多角色和世界细节的扩展版本

每个版本都应：
- 从第一行就开始吸引人
- 立即传达类型和基调
- 以引人入胜的问题或赌注声明结束
- 永远不要剧透结局
- 符合目标类型读者的期望`,
      },
      {
        label: '亚马逊书籍描述',
        skill: 'blurb-writer',
        taskType: 'marketing',
        promptTemplate: `为以下内容创建亚马逊优化的书籍描述：{{description}}

使用亚马逊支持的 HTML 标签进行格式化：
- <b>粗体</b> 用于强调
- <br> 用于换行
- <i>斜体</i> 用于标题和强调

结构：
1. **开场钩子**（粗体，引人注目）
2. **角色介绍**（他们是谁，他们想要什么）
3. **冲突与赌注**（什么阻碍了他们，如果他们失败了会怎样）
4. **类型信号**（套路，基调，对标作品：“完美适合...的粉丝”）
5. **行动号召**（粗体：“立即购买”或“今天开始阅读”）

还包括一个评论引用模板：“___ ★★★★★”格式。`,
      },
      {
        label: '亚马逊类别与关键词',
        skill: 'research',
        taskType: 'research',
        promptTemplate: `研究以下内容的亚马逊类别和关键词：{{description}}

提供：
1. **7个关键词/短语**（每个最多50个字符）：基于研究的读者搜索关键词。混合特定套路 + 类型术语 +情感钩子
2. **2个 BISAC 类别**：最适合的主要和次要类别
3. **亚马逊浏览类别**：2-3个特定的亚马逊类别路径（例如：Kindle Store > Romance > Contemporary > New Adult）
4. **BISAC 代码**：所选类别的字母数字代码

解释为什么要选择每个关键词/类别 — 它针对的是什么样的搜索行为？`,
      },
      {
        label: '广告文案生成',
        skill: 'ad-copy',
        taskType: 'marketing',
        promptTemplate: `为以下内容创建广告文案：{{description}}

**亚马逊广告 (AMS)**：
- 3个标题变体（每个最多150个字符）
- 关注类型关键词和情感钩子

**Facebook/Meta 广告**：
- 2个主要文本变体（简短，有力）
- 2个标题变体
- 建议的受众目标（兴趣，相似作者）

**BookBub 精选特价**：
- 1个描述（最适合 BookBub 的格式和受众）
- 建议的特价策略

每个变体都应使用不同的角度：情感，套路，对标作品，问题，紧迫性。`,
      },
      {
        label: '社交媒体发布帖子',
        skill: 'blurb-writer',
        taskType: 'marketing',
        promptTemplate: `为以下内容创建社交媒体发布内容：{{description}}

**Instagram/BookStagram**（3个帖子）：
- 封面揭晓帖子（说明 + 标签）
- 发布日帖子
- “我为什么要写这本书”的个人帖子

**Twitter/X**（5条推文）：
- 发布公告
- 一句话简介推文
- 角色介绍主题帖开头
- 读者对标（“如果你喜欢X，你会喜欢...”）
- 书中引语（带格式）

**TikTok/BookTok**（2个视频概念）：
- 每个视频的概念 + 脚本大纲

**电子邮件通讯**：
- 发布公告电子邮件（主题行 + 正文）

包括每个平台的相关标签。`,
      },
      {
        label: '发布清单与时间表',
        skill: 'format',
        taskType: 'general',
        promptTemplate: `为以下内容创建书籍发布清单和时间表：{{description}}

**预发布（发布前4-6周）**：
- ARC 分发，封面揭晓时间，预购设置

**发布周**：
- 每日社交媒体日程安排
- 电子邮件序列
- 广告激活时间表

**发布后（发布后2-4周）**：
- 征集评论，广告优化，时事通讯跟进

包括相对于发布日的具体可操作项目和日期（L-30, L-14, L-7, L-Day, L+7 等）`,
      },
      {
        label: '书籍封面概念',
        skill: 'book-launch',
        taskType: 'marketing',
        promptTemplate: `为以下内容生成2个书籍封面概念想法：{{description}}

为每个概念提供：
1. **视觉描述** — 详细的场景，构图，图像，关键视觉元素
2. **排版建议** — 字体样式建议，书名位置（上/中/下），作者名位置
3. **调色板** — 3-5个带有情绪/情感推理的十六进制颜色代码
4. **对标封面** — 该类型中具有相似风格的2-3个畅销封面
5. **AI 图像生成提示** — 一个详细的、随时可用的使用 AI 生成封面艺术的提示词（仅描述图像，不含文本）

清楚地标记推荐的概念。关注在亚马逊缩略图大小中脱颖而出的符合类型的设计。`,
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════
  // Novel Pipeline (kept from V3 — auto-generates 30+ steps)
  // ═══════════════════════════════════════════════════════════
  {
    type: 'keyword-book-mvp',
    label: '关键词书籍 MVP',
    description: '关键词 → 3个候选 → 选择一个 → 扩展项目 → 大纲章节 → 起草，修订和完成',
    steps: [],
  },

  {
    type: 'novel-pipeline',
    label: '完整小说流水线',
    description: '从前提到最终手稿编写一本完整的小说 — 前提、角色、世界观、大纲、章节、修订和组装',
    steps: [], // 30+ steps are auto-generated by createNovelPipeline()
  },
];

// ═══════════════════════════════════════════════════════════
// Project Engine
// ═══════════════════════════════════════════════════════════

export class ProjectEngine {
  private projects: Map<string, Project> = new Map();
  private authorOS: AuthorOSService | null;
  private rootDir: string;
  private nextId = 1;
  private aiComplete: AICompleteFunc | null = null;
  private aiSelectProvider: AISelectProviderFunc | null = null;
  private coreLessonsCache: string | null = null;
  private coreLessonsCacheTime = 0;
  private stateFilePath: string;
  private saveDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(authorOS?: AuthorOSService, rootDir?: string) {
    this.authorOS = authorOS || null;
    this.rootDir = rootDir || process.cwd();
    this.stateFilePath = join(this.rootDir, 'workspace', '.config', 'projects-state.json');
    this.loadState();  // Restore projects from disk on startup
  }

  /**
   * Persist all project state to disk (debounced — max once per second).
   * Non-fatal: if save fails, projects continue to work in-memory.
   */
  private persistState(): void {
    if (this.saveDebounceTimer) clearTimeout(this.saveDebounceTimer);
    this.saveDebounceTimer = setTimeout(async () => {
      try {
        const { mkdir } = await import('fs/promises');
        const { dirname } = await import('path');
        await mkdir(dirname(this.stateFilePath), { recursive: true });
        const state = {
          nextId: this.nextId,
          projects: Array.from(this.projects.values()).map(p => ({
            ...p,
            // Strip large step results to save space — they're already saved as individual files
            steps: p.steps.map(s => ({
              ...s,
              result: s.result ? s.result.substring(0, 500) + (s.result.length > 500 ? '\n\n[... truncated for state file — full output in project files ...]' : '') : undefined,
            })),
          })),
        };
        const { writeFile: wf } = await import('fs/promises');
        await wf(this.stateFilePath, JSON.stringify(state, null, 2), 'utf-8');
      } catch (err) {
        console.error('  ⚠ Failed to persist project state:', err);
      }
    }, 1000);
  }

  /**
   * Load project state from disk on startup.
   */
  private loadState(): void {
    try {
      if (!existsSync(this.stateFilePath)) return;
      const raw = readFileSync(this.stateFilePath, 'utf-8');
      const state = JSON.parse(raw);
      if (state.nextId) this.nextId = state.nextId;
      if (Array.isArray(state.projects)) {
        for (const p of state.projects) {
          this.projects.set(p.id, p);
        }
        console.log(`  ✓ Restored ${state.projects.length} projects from disk`);
      }
    } catch (err) {
      console.error('  ⚠ Failed to load project state:', err);
    }
  }

  /**
   * Wire up AI capabilities so ProjectEngine can call the AI for dynamic planning.
   * Called after the router is initialized in index.ts.
   */
  setAI(complete: AICompleteFunc, selectProvider: AISelectProviderFunc): void {
    this.aiComplete = complete;
    this.aiSelectProvider = selectProvider;
  }

  async generateKeywordBookCandidates(keyword: string): Promise<KeywordBookCandidate[]> {
    const cleaned = keyword.trim();
    if (!cleaned) return [];

    if (!this.aiComplete || !this.aiSelectProvider) {
      return this.buildFallbackKeywordCandidates(cleaned);
    }

    try {
      const provider = this.aiSelectProvider('outline');
      const prompt = `You are designing commercial long-form Chinese web novel / fiction concepts.

Given a keyword or short topic, generate EXACTLY 3 distinct candidate book concepts.

Output ONLY valid JSON:
{"candidates":[
  {"title":"", "hook":"", "premise":"", "audience":"", "highlights":["", "", ""]},
  {"title":"", "hook":"", "premise":"", "audience":"", "highlights":["", "", ""]},
  {"title":"", "hook":"", "premise":"", "audience":"", "highlights":["", "", ""]}
]}

Requirements:
- Write in Simplified Chinese
- Candidates must be clearly different in direction / tone / conflict
- premise should be 120-220 Chinese characters
- highlights must contain exactly 3 short bullets
- Keep them production-friendly for a very long manuscript project

Keyword: ${cleaned}`;

      const result = await this.aiComplete({
        provider: provider.id,
        system: prompt,
        messages: [{ role: 'user', content: cleaned }],
        maxTokens: 2200,
        temperature: 0.8,
      });

      const parsed = this.parseCandidatesResponse(result.text);
      if (parsed.length === 3) return parsed;
    } catch (error) {
      console.error('  ⚠ Failed to generate keyword book candidates via AI:', error);
    }

    return this.buildFallbackKeywordCandidates(cleaned);
  }

  createKeywordBookProject(
    title: string,
    description: string,
    config: KeywordBookProjectConfig
  ): Project {
    const id = `project-${this.nextId++}`;
    const now = new Date().toISOString();
    const targetWords = Math.max(config.targetWords || 500000, 10000);
    const wordsPerChapter = Math.max(config.targetWordsPerChapter || 4000, 1000);
    const chapterCount = Math.min(Math.max(Math.ceil(targetWords / wordsPerChapter), 1), 300);
    const candidate = config.selectedCandidate;

    const steps: ProjectStep[] = [];
    let stepNum = 0;
    const addStep = (
      label: string,
      phase: string,
      taskType: string,
      prompt: string,
      opts: { skill?: string; wordCountTarget?: number; chapterNumber?: number } = {}
    ) => {
      stepNum++;
      steps.push({
        id: `${id}-step-${stepNum}`,
        label,
        phase,
        taskType,
        prompt,
        status: 'pending',
        skill: opts.skill,
        wordCountTarget: opts.wordCountTarget,
        chapterNumber: opts.chapterNumber,
      });
    };

    addStep(
      '项目扩展',
      'expansion',
      'outline',
      `你现在要把一个已选题方案扩展成可执行的超长篇写作项目。

项目标题：${title}
关键词：${config.keyword}
目标总字数：${targetWords}
预计章节数：${chapterCount}
单章目标字数：${wordsPerChapter}

已选方案：
- 标题：${candidate.title}
- 核心钩子：${candidate.hook}
- 核心设定：${candidate.premise}
- 目标读者：${candidate.audience}
- 卖点：${candidate.highlights.join('；')}

请输出一份中文项目扩展稿，至少包含：
1. 故事主线
2. 主角/核心人物关系
3. 世界观或主要舞台
4. 长线冲突与升级节奏
5. 适合长篇连载推进的内容抓手
6. 分卷/阶段建议
7. 风格与写作约束

要求：可直接作为后续章节规划输入，内容具体、结构清晰。`,
      { skill: 'outline' }
    );

    addStep(
      '生成章节概要',
      'outline',
      'outline',
      `基于已经扩展好的项目资料，为《${title}》生成完整的章节概要。

硬性要求：
- 总目标字数：${targetWords}
- 章节数：${chapterCount}
- 每章目标字数：${wordsPerChapter}
- 必须覆盖全部章节，从第1章到第${chapterCount}章

对每一章都给出：
1. 章节标题
2. 本章目标
3. 关键情节推进
4. 角色变化/冲突
5. 章节结尾钩子
6. 建议字数

要求：
- 使用中文
- 保证章节之间有递进
- 前中后期节奏明显
- 适合后续逐章生成，便于引用。`,
      { skill: 'outline' }
    );

    for (let ch = 1; ch <= chapterCount; ch++) {
      addStep(
        `生成第${ch}章`,
        'draft',
        'creative_writing',
        `现在开始生成《${title}》第${ch}章正文。

要求：
- 依据既有项目扩展资料和章节概要
- 本章写成完整正文，不要写成大纲或说明
- 目标字数不少于${wordsPerChapter}
- 强调情节推进、人物行动、对话与场景
- 结尾保留推进下一章的钩子
- 输出仅为正文内容`,
        { skill: 'write', wordCountTarget: wordsPerChapter, chapterNumber: ch }
      );

      addStep(
        `检查并修订第${ch}章`,
        'revision',
        'revision',
        `对《${title}》第${ch}章进行基础检查与修订。

请完成：
1. 检查是否偏离本章概要
2. 检查剧情是否连贯
3. 检查角色行为和语气是否一致
4. 检查是否存在明显重复、空话、概述化表达
5. 在不改变主线的前提下，直接输出修订后的完整章节正文

要求：
- 保持本章为完整正文
- 修订后尽量不低于${Math.round(wordsPerChapter * 0.9)}字
- 输出仅为修订后的正文`,
        { skill: 'revise', chapterNumber: ch }
      );
    }

    addStep(
      '完结与达标报告',
      'assembly',
      'general',
      `请为《${title}》生成一份完结报告。

目标总字数：${targetWords}
预计章节数：${chapterCount}

报告需要包含：
1. 项目是否达到目标字数
2. 实际完成章节数
3. 全书主线是否闭环
4. 还可继续优化的点
5. 一段结项总结

用中文输出，适合作为项目收尾说明。`
    );

    const project: Project = {
      id,
      type: 'keyword-book-mvp',
      title,
      description,
      status: 'pending',
      progress: 0,
      steps,
      createdAt: now,
      updatedAt: now,
      context: {
        workflow: 'keyword-book-mvp',
        keyword: config.keyword,
        selectedCandidate: candidate,
        targetWords,
        targetWordsPerChapter: wordsPerChapter,
        targetChapters: chapterCount,
        estimatedTotalWords: chapterCount * wordsPerChapter,
      },
    };

    this.projects.set(id, project);
    this.persistState();
    console.log(`  ✓ Keyword book MVP created: "${title}" — ${chapterCount} chapters, ~${targetWords.toLocaleString()} words target`);
    return project;
  }

  // ── Novel Pipeline ──

  /**
   * Create a full novel pipeline project with 30+ steps covering all phases:
   * premise → book bible → outline → writing → revision → assembly
   */
  createNovelPipeline(title: string, description: string, config: NovelPipelineConfig = {}): Project {
    const id = `project-${this.nextId++}`;
    const now = new Date().toISOString();

    // Default changed to 25 chapters * 4000 words = 100k words
    const chapters = Math.min(Math.max(config.targetChapters || 25, 1), 200);
    const wordsPerChapter = Math.max(config.targetWordsPerChapter || 4000, 100);

    // Build premise context from config fields
    const premiseContext = [
      config.logline && `Logline: ${config.logline}`,
      config.genre && `Genre: ${config.genre}`,
      config.setting && `Setting: ${config.setting}`,
      config.tone && `Tone: ${config.tone}`,
      config.pov && `POV: ${config.pov}`,
      config.tense && `Tense: ${config.tense}`,
      config.themes && `Themes: ${config.themes}`,
      config.protagonistName && `Protagonist: ${config.protagonistName}`,
      config.antagonistName && `Antagonist: ${config.antagonistName}`,
    ].filter(Boolean).join('\n');

    const premiseBlock = premiseContext
      ? `\n\nProject Configuration:\n${premiseContext}`
      : '';

    // Calculate structural beats for outline
    const setupEnd = Math.max(Math.round(chapters * 0.12), 1);
    const incitingEnd = Math.max(Math.round(chapters * 0.20), setupEnd + 1);
    const midpoint = Math.round(chapters * 0.50);
    const twist75 = Math.round(chapters * 0.75);
    const climaxStart = chapters - 2;
    const climaxEnd = chapters - 1;

    const steps: ProjectStep[] = [];
    let stepNum = 0;

    const addStep = (
      label: string,
      phase: string,
      taskType: string,
      prompt: string,
      opts: { skill?: string; wordCountTarget?: number; chapterNumber?: number } = {}
    ) => {
      stepNum++;
      steps.push({
        id: `${id}-step-${stepNum}`,
        label,
        phase,
        taskType,
        prompt,
        status: 'pending',
        skill: opts.skill,
        wordCountTarget: opts.wordCountTarget,
        chapterNumber: opts.chapterNumber,
      });
    };

    // ── Phase: Premise (2 steps) ──
    addStep('开发前提', 'premise', 'general',
      `将这个故事概念开发成“${title}”的完整前提：${premiseBlock}\n\n${description}\n\n创建：\n- 一个精炼的标语（1-2句话）\n- 核心的“如果...会怎样”问题\n- 主角的想要与需要\n- 核心冲突\n- 赌注：个人、职业和全局\n- 主题陈述\n- 3个对标作品\n\n写出全面、详细的回复。不要简写。`,
      { skill: 'premise' }
    );

    addStep('完善前提', 'premise', 'general',
      `进一步完善“${title}”的前提。使用初始前提中的所有内容，添加：\n- 反派的动机和逻辑\n- 倒计时：什么具体的截止日期创造了紧迫感？\n- 3个可能的情节反转（一个在中点，一个在75%处，一个最终揭示）\n- 情感核心：什么个人损失或创伤驱使着主角？\n\n写出全面、详细的回复。`,
      { skill: 'premise' }
    );

    // ── Phase: Book Bible (6 steps) ──
    addStep('主角档案', 'bible', 'book_bible',
      `为“${title}”创建详细的主角档案。\n\n包含：全名、年龄、角色、技能、致命缺陷、情感创伤、背景故事、动机（想要与需要）、从头到尾的角色弧线、言语模式、外貌描述以及关键人际关系。\n\n写出500字以上的实质性角色发展内容。`,
      { skill: 'book-bible' }
    );

    addStep('反派档案', 'bible', 'book_bible',
      `为“${title}”创建详细的反派档案。\n\n包含：能力、限制、目标、动机、背景故事、沟通风格、性格怪癖、他们为什么认为自己是对的，以及他们如何挑战主角。\n\n写出500字以上的实质性角色发展内容。`,
      { skill: 'book-bible' }
    );

    addStep('配角档案', 'bible', 'book_bible',
      `为“${title}”创建3-4个配角档案。\n\n对于每个角色包含：姓名、年龄、在故事中的角色、与主角的关系、动机、背景故事、性格特征、言语模式，以及他们如何对主角的成长弧线做出贡献。\n\n总共写出500字以上。`,
      { skill: 'book-bible' }
    );

    addStep('主要地点', 'bible', 'book_bible',
      `为“${title}”构建主要地点。\n\n创建4-5个关键地点。对于每个地点：名称、物理描述、氛围、常客、对情节的意义以及感官细节（声音、气味、质地、光线）。\n\n写出500字以上。`,
      { skill: 'book-bible' }
    );

    addStep('时间线', 'bible', 'book_bible',
      `为“${title}”创建详细的时间线。\n\n包含：小说开始前的关键背景事件、主要情节事件的时间顺序、危机升级点以及解决时间线。注明每个关键事件中有哪些角色在场。\n\n写出500字以上。`,
      { skill: 'book-bible' }
    );

    addStep('世界规则与一致性指南', 'bible', 'consistency',
      `为“${title}”创建一致性指南和世界规则文档。\n\n包含：命名约定、关键术语、必须保持一致的角色物理细节、技术/魔法规则、社会结构，以及任何其他必须在 ${chapters} 个章节中保持一致的细节。\n\n写出500字以上。`,
      { skill: 'book-bible' }
    );

    // ── Phase: Outline (2 steps) ──
    addStep('章节大纲', 'outline', 'outline',
      `为“${title}”创建带有结构节拍的 ${chapters} 章大纲。\n\n对于每一章包含：\n- 章节号和标题\n- 视点 (POV) 角色\n- 主要地点\n- 3-5个关键节拍\n- 紧张程度 (1-10)\n- 章节结尾钩子\n\n结构：\n- 第 1-${setupEnd} 章：设定和世界介绍\n- 第 ${setupEnd + 1}-${incitingEnd} 章：引发事件\n- 第 ${incitingEnd + 1}-${midpoint - 1} 章：情节发展\n- 第 ${midpoint} 章：中点反转\n- 第 ${midpoint + 1}-${twist75 - 1} 章：复杂情况增加\n- 第 ${twist75} 章：75%反转 / 一败涂地\n- 第 ${climaxStart}-${climaxEnd} 章：高潮序列\n- 第 ${chapters} 章：结局\n\n你必须包含所有 ${chapters} 章。不要提前停止。为每一章编号。`,
      { skill: 'outline' }
    );

    addStep('场景分解', 'outline', 'outline',
      `将 ${chapters} 章的大纲扩展为“${title}”的逐个场景分解。\n\n为每一章创建2-4个场景，包含：\n- 场景目标和冲突\n- 关键对话时刻或揭示\n- 情感节拍\n- 每个场景的估计字数\n\n目标是每章约 ${wordsPerChapter} 字。特别关注引发事件、中点反转和高潮序列。`,
      { skill: 'outline' }
    );

    // ── Phase: Writing (N steps, one per chapter) ──
    for (let ch = 1; ch <= chapters; ch++) {
      addStep(`编写第 ${ch} 章`, 'writing', 'creative_writing',
        `编写“${title}”的第 ${ch} 章。\n\n说明：\n- 遵循本章的大纲节拍和场景分解\n- 检查设定集以保持角色一致性\n- 你必须写出至少 ${wordsPerChapter} 字的实际散文叙述\n- 以吸引人的钩子开篇 — 不要兜圈子\n- 以让读者想翻页的理由结束\n- 包含感官细节和内在张力\n- 将完整的章节写成实际的散文，而不是摘要\n- 不要写少于 ${wordsPerChapter} 字。如果字数不够，添加更多场景、对话、内心独白、感官细节。`,
        { skill: 'write', wordCountTarget: wordsPerChapter, chapterNumber: ch }
      );
    }

    // ── Phase: Revision (3 steps) ──
    addStep('结构性编辑', 'revision', 'revision',
      `对“${title}”的所有 ${chapters} 章执行结构性编辑。\n\n分析：\n- 贯穿整个故事弧线的情节结构和节奏\n- 角色弧线的完成度（角色是否按计划成长/改变？）\n- 紧张感和赌注的升级\n- 主题连贯性\n- 章节之间的叙事驱动力和钩子\n\n提供具体的、逐章的反馈和可操作的建议。`,
      { skill: 'revise' }
    );

    addStep('行级编辑笔记', 'revision', 'revision',
      `对“${title}”执行行级编辑审查。\n\n重点关注：\n- 句子节奏和多样性\n- 词语选择和动词力度\n- 展示与讲述的实例\n- 对话质量和提示语的使用\n- 散文的清晰度和流畅度\n- 需要删减的填充词（突然，非常，只是，基本上）\n\n提供章节中的具体示例和修改前/后的建议。`,
      { skill: 'revise' }
    );

    addStep('一致性检查', 'revision', 'consistency',
      `根据设定集对“${title}”的所有 ${chapters} 章运行一致性检查。\n\n检查：\n- 角色描述矛盾\n- 时间线不一致\n- 地点细节不匹配\n- 世界规则违反\n- 情节漏洞或遗漏的线索\n- 基调/声音不一致\n\n列出任何问题并附上具体的章节出处。`,
      { skill: 'revise' }
    );

    // ── Phase: Assembly (1 step) ──
    addStep('组装手稿与报告', 'assembly', 'general',
      `生成“${title}”的完成报告。\n\n包含：\n- 总章节数：${chapters}\n- 目标字数：约 ${(chapters * wordsPerChapter).toLocaleString()} 字\n- 对手稿优势的评估\n- 未来草稿需要改进的领域\n- 2-3句话的封底简介\n- 后续步骤的建议（试读者、专业编辑等）\n\n所有章节文件已单独保存。本报告总结了完整的流水线。`
    );

    const project: Project = {
      id,
      type: 'novel-pipeline',
      title,
      description,
      status: 'pending',
      progress: 0,
      steps,
      createdAt: now,
      updatedAt: now,
      context: {
        planning: 'novel-pipeline',
        config,
        targetChapters: chapters,
        targetWordsPerChapter: wordsPerChapter,
        estimatedTotalWords: chapters * wordsPerChapter,
      },
    };

    this.projects.set(id, project);
    this.persistState();
    console.log(`  ✓ Novel pipeline created: "${title}" — ${steps.length} steps, ${chapters} chapters, ~${(chapters * wordsPerChapter).toLocaleString()} words target`);
    return project;
  }

  // ── Template Discovery ──

  /**
   * Return all available project templates for the dashboard
   */
  getTemplates(): Array<{ type: ProjectType; label: string; description: string; stepCount: number; stepCountLabel?: string }> {
    return PROJECT_TEMPLATES.map(t => ({
      type: t.type,
      label: t.label,
      description: t.description,
      stepCount: t.type === 'novel-pipeline' ? 30 : t.steps.length,
      stepCountLabel: t.type === 'novel-pipeline' ? '30+ 自动生成的步骤' : undefined,
    }));
  }

  // ── Dynamic Planning (The "Magic") ──

  /**
   * Ask the AI to decompose a task into steps dynamically.
   * This is the core "tell the agent what you want and it figures out the steps" feature.
   * Falls back to template-based planning if AI planning fails.
   */
  async planProject(
    title: string,
    description: string,
    skillCatalog: SkillCatalogEntry[],
    authorOSTools: string[],
    context?: Record<string, any>
  ): Promise<Project> {
    if (!this.aiComplete || !this.aiSelectProvider) {
      // No AI wired — fall back to template
      console.log('  \u26a0 AI not wired for planning \u2014 falling back to template');
      const type = this.inferProjectType(description);
      return this.createProject(type, title, description, context);
    }

    try {
      const provider = this.aiSelectProvider('general');

      // Build skill catalog for the planner prompt
      const skillList = skillCatalog.map(s =>
        `- **${s.name}** (${s.category}${s.premium ? ' \u2605' : ''}): ${s.description} [triggers: ${s.triggers.join(', ')}]`
      ).join('\n');

      const toolList = authorOSTools.length > 0
        ? `\n\nAuthor OS Tools Available:\n${authorOSTools.map(t => `- ${t}`).join('\n')}`
        : '';

      const validTaskTypes = Object.keys(TASK_TYPE_MAP).join(', ');

      const plannerPrompt = `You are a task planner for AuthorClaw, an autonomous AI writing agent.

The user wants to accomplish something. Your job is to break it down into a sequence of concrete, executable steps.

## Available Skills
${skillList}
${toolList}

## Valid Task Types
${validTaskTypes}

## Rules
1. Match step count to task complexity:
   - Simple tasks (write a blurb, intro, scene, short piece): 1-2 steps
   - Medium tasks (outline a story, research a topic, analyze style): 3-5 steps
   - Large tasks (write a full novel/book): 7-15 steps with ALL phases
2. ONLY plan full novel pipelines (premise \u2192 characters \u2192 world \u2192 outline \u2192 chapters \u2192 revision \u2192 assembly) when the user EXPLICITLY asks for a novel, book, or full manuscript
3. Each step should be a single, focused task
4. Reference specific skills by name when relevant
5. Use appropriate taskType for each step (affects which AI model is used)
6. Each step's prompt should be detailed enough to execute standalone
7. Later steps should reference earlier work naturally (e.g., "Using the characters we developed...")

## Output Format
Return ONLY valid JSON, no markdown fences, no explanation:
{"steps":[{"label":"step name","skill":"skill-name-or-null","taskType":"task_type","prompt":"detailed prompt for this step"}]}

## User's Request
Title: ${title}
Description: ${description}`;

      const result = await this.aiComplete({
        provider: provider.id,
        system: plannerPrompt,
        messages: [{ role: 'user', content: `Plan the steps to accomplish: ${description}` }],
        maxTokens: 4096,
        temperature: 0.3,
      });

      // Parse the AI's response
      const parsed = this.parsePlanResponse(result.text);

      if (parsed && parsed.steps && parsed.steps.length > 0) {
        // Build the project from AI-planned steps
        const id = `project-${this.nextId++}`;
        const now = new Date().toISOString();

        const steps: ProjectStep[] = parsed.steps.map((s: any, i: number) => ({
          id: `${id}-step-${i + 1}`,
          label: s.label || `Step ${i + 1}`,
          skill: s.skill && s.skill !== 'null' ? s.skill : undefined,
          taskType: s.taskType || 'general',
          prompt: s.prompt || description,
          status: 'pending' as const,
        }));

        // Enhance with Author OS
        const enhancedSteps = this.authorOS ? this.enhanceWithAuthorOS(steps) : steps;

        const project: Project = {
          id,
          type: this.inferProjectType(description),
          title,
          description,
          status: 'pending',
          progress: 0,
          steps: enhancedSteps,
          createdAt: now,
          updatedAt: now,
          context: { ...context, planning: 'dynamic', planProvider: result.provider },
        };

        this.projects.set(id, project);
        this.persistState();
        console.log(`  \u2713 AI planned ${steps.length} steps for "${title}" (via ${result.provider})`);
        return project;
      }

      // If parsing failed, fall back to template
      console.log('  \u26a0 AI plan parsing failed \u2014 falling back to template');
      const type = this.inferProjectType(description);
      return this.createProject(type, title, description, context);

    } catch (error) {
      console.error('  \u2717 AI planning failed:', error);
      const type = this.inferProjectType(description);
      return this.createProject(type, title, description, context);
    }
  }

  /**
   * Parse the AI's JSON plan response, handling common formatting issues
   */
  private parsePlanResponse(text: string): any {
    // Strip markdown code fences if present
    let cleaned = text.trim();
    cleaned = cleaned.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '');
    cleaned = cleaned.trim();

    try {
      return JSON.parse(cleaned);
    } catch {
      // Try to extract JSON from mixed text
      const jsonMatch = cleaned.match(/\{[\s\S]*"steps"[\s\S]*\}/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[0]);
        } catch { /* fall through */ }
      }
      return null;
    }
  }

  // ── Project Lifecycle ──

  /**
   * Create a new project from a template or custom definition.
   * Returns the project with auto-planned steps.
   */
  createProject(
    type: ProjectType,
    title: string,
    description: string,
    context?: Record<string, any>
  ): Project {
    const id = `project-${this.nextId++}`;
    const now = new Date().toISOString();

    // Find matching template
    const template = PROJECT_TEMPLATES.find(t => t.type === type);

    let steps: ProjectStep[];

    if (template) {
      console.log(`  Project "${title}": using template "${type}" with ${template.steps.length} steps`);
      steps = template.steps.map((s, i) => ({
        id: `${id}-step-${i + 1}`,
        label: s.label,
        skill: s.skill,
        toolSuggestion: s.toolSuggestion,
        taskType: s.taskType,
        prompt: this.expandTemplate(s.promptTemplate, { title, description, ...context }),
        status: 'pending' as const,
      }));
    } else {
      // Custom project — single step with the user's description
      console.warn(`  Project "${title}": no template found for type "${type}" — creating single-step project`);
      steps = [{
        id: `${id}-step-1`,
        label: title,
        taskType: this.inferTaskType(description),
        prompt: description,
        status: 'pending',
      }];
    }

    // Enhance steps with Author OS tool suggestions if available
    if (this.authorOS) {
      steps = this.enhanceWithAuthorOS(steps);
    }

    const project: Project = {
      id,
      type,
      title,
      description,
      status: 'pending',
      progress: 0,
      steps,
      createdAt: now,
      updatedAt: now,
      context: context || {},
    };

    this.projects.set(id, project);
    this.persistState();
    return project;
  }

  /**
   * Get a specific project by ID
   */
  getProject(id: string): Project | undefined {
    return this.projects.get(id);
  }

  /**
   * List all projects, optionally filtered by status
   */
  listProjects(status?: string): Project[] {
    const projects = Array.from(this.projects.values());
    if (status) {
      return projects.filter(p => p.status === status);
    }
    return projects;
  }

  getProjectWordStats(projectId: string): {
    totalWords: number;
    targetWords: number;
    completedChapters: number;
    targetReached: boolean;
  } {
    const project = this.projects.get(projectId);
    if (!project) {
      return { totalWords: 0, targetWords: 0, completedChapters: 0, targetReached: false };
    }

    const revisedSteps = project.steps.filter(s => s.phase === 'revision' && s.status === 'completed' && s.result);
    const sourceSteps = revisedSteps.length > 0
      ? revisedSteps
      : project.steps.filter(s => s.phase === 'draft' && s.status === 'completed' && s.result);

    const totalWords = sourceSteps.reduce((sum, step) => {
      return sum + (step.result ? step.result.trim().split(/\s+/).filter(Boolean).length : 0);
    }, 0);
    const targetWords = Number(project.context?.targetWords || project.context?.estimatedTotalWords || 0);

    return {
      totalWords,
      targetWords,
      completedChapters: sourceSteps.filter(s => s.chapterNumber).length,
      targetReached: targetWords > 0 ? totalWords >= targetWords : false,
    };
  }

  /**
   * Start executing a project — marks it active and returns the first step
   */
  startProject(id: string): ProjectStep | null {
    const project = this.projects.get(id);
    if (!project) return null;

    project.status = 'active';
    project.updatedAt = new Date().toISOString();

    const firstPending = project.steps.find(s => s.status === 'pending');
    if (firstPending) {
      firstPending.status = 'active';
      return firstPending;
    }

    return null;
  }

  /**
   * Complete the current step and advance to the next.
   * Returns the next step, or null if the project is complete.
   */
  completeStep(projectId: string, stepId: string, result: string): ProjectStep | null {
    const project = this.projects.get(projectId);
    if (!project) return null;

    const step = project.steps.find(s => s.id === stepId);
    if (step) {
      step.status = 'completed';
      step.result = result;
    }

    // Calculate progress (include skipped as "done")
    const done = project.steps.filter(s => s.status === 'completed' || s.status === 'skipped').length;
    project.progress = Math.round((done / project.steps.length) * 100);
    project.updatedAt = new Date().toISOString();

    // Find next step to run — prefer pending, then check for orphaned active steps
    // (active steps can occur from race conditions in concurrent auto-execute)
    const next = project.steps.find(s => s.status === 'pending')
              || project.steps.find(s => s.status === 'active' && s.id !== stepId);
    if (next) {
      next.status = 'active';
      // Enrich the next prompt with results from completed steps
      next.prompt = this.enrichWithPriorResults(next.prompt, project);
      return next;
    }

    // Truly all steps done — mark project complete only if no pending/active remain
    const remaining = project.steps.filter(s => s.status === 'pending' || s.status === 'active');
    if (remaining.length === 0) {
      project.status = 'completed';
      project.completedAt = new Date().toISOString();
    }
    this.persistState();
    return null;
  }

  /**
   * Mark a step as failed
   */
  failStep(projectId: string, stepId: string, error: string): void {
    const project = this.projects.get(projectId);
    if (!project) return;

    const step = project.steps.find(s => s.id === stepId);
    if (step) {
      step.status = 'failed';
      step.error = error;
    }

    project.updatedAt = new Date().toISOString();
    this.persistState();
  }

  /**
   * Skip a step
   */
  skipStep(projectId: string, stepId: string): ProjectStep | null {
    const project = this.projects.get(projectId);
    if (!project) return null;

    const step = project.steps.find(s => s.id === stepId);
    if (step) {
      step.status = 'skipped';
    }

    // Update progress
    const done = project.steps.filter(s => s.status === 'completed' || s.status === 'skipped').length;
    project.progress = Math.round((done / project.steps.length) * 100);
    project.updatedAt = new Date().toISOString();

    // Advance
    const next = project.steps.find(s => s.status === 'pending');
    if (next) {
      next.status = 'active';
      this.persistState();
      return next;
    }

    project.status = 'completed';
    project.completedAt = new Date().toISOString();
    this.persistState();
    return null;
  }

  /**
   * Pause a project
   */
  pauseProject(id: string): void {
    const project = this.projects.get(id);
    if (!project) return;
    project.status = 'paused';
    project.updatedAt = new Date().toISOString();

    // Pause any active steps
    project.steps.forEach(s => {
      if (s.status === 'active') s.status = 'pending';
    });
    this.persistState();
  }

  /**
   * Delete a project
   */
  deleteProject(id: string): boolean {
    const result = this.projects.delete(id);
    if (result) this.persistState();
    return result;
  }

  updateStepContent(
    projectId: string,
    stepId: string,
    updates: { prompt?: string; result?: string; appendOperatorNote?: string }
  ): ProjectStep | null {
    const project = this.projects.get(projectId);
    if (!project) return null;
    const step = project.steps.find(s => s.id === stepId);
    if (!step) return null;

    if (typeof updates.prompt === 'string') {
      step.prompt = updates.prompt;
    }
    if (typeof updates.result === 'string') {
      step.result = updates.result;
    }
    if (typeof updates.appendOperatorNote === 'string' && updates.appendOperatorNote.trim()) {
      step.prompt += `\n\n[人工干预说明]\n${updates.appendOperatorNote.trim()}`;
      project.context = project.context || {};
      project.context.operatorNotes = project.context.operatorNotes || [];
      project.context.operatorNotes.push({
        stepId,
        note: updates.appendOperatorNote.trim(),
        updatedAt: new Date().toISOString(),
      });
    }

    project.updatedAt = new Date().toISOString();
    this.persistState();
    return step;
  }

  finalizeProject(id: string): Project | null {
    const project = this.projects.get(id);
    if (!project) return null;

    project.steps.forEach(step => {
      if (step.status === 'pending' || step.status === 'active') {
        step.status = 'skipped';
      }
    });

    project.status = 'completed';
    project.progress = 100;
    project.context = project.context || {};
    project.context.finalizedManually = true;
    project.context.finalizedAt = new Date().toISOString();
    project.completedAt = new Date().toISOString();
    project.updatedAt = project.completedAt;
    this.persistState();
    return project;
  }

  /**
   * Build the system prompt addition for a project step.
   * This tells the AI what context it's operating in.
   */
  async buildProjectContext(project: Project, step: ProjectStep): Promise<string> {
    let context = `\n# Current Project\n\n`;
    context += `**Project**: ${project.title}\n`;
    context += `**Type**: ${project.type}\n`;
    context += `**Progress**: ${project.progress}% (step ${project.steps.indexOf(step) + 1} of ${project.steps.length})\n`;
    context += `**Current Step**: ${step.label}\n\n`;

    // Novel pipeline: phase-aware context accumulation
    if (project.type === 'novel-pipeline' && step.phase) {
      context += this.buildNovelPipelineContext(project, step);
    } else if (project.type === 'keyword-book-mvp' && step.phase) {
      context += this.buildKeywordBookContext(project, step);
    } else {
      // Default: add results from prior steps
      const completedSteps = project.steps.filter(s => s.status === 'completed' && s.result);
      if (completedSteps.length > 0) {
        context += `## Previous Steps Completed\n\n`;
        for (const cs of completedSteps) {
          context += `### ${cs.label}\n`;
          const result = cs.result!;
          if (result.length > 2000) {
            context += `[...truncated...]\n${result.slice(-2000)}\n\n`;
          } else {
            context += `${result}\n\n`;
          }
        }
      }
    }

    // Include uploaded manuscript content (from Upload button)
    if (project.context?.uploadedContent) {
      const uploads = project.context.uploads || [];
      const fileList = uploads.map((u: any) => `${u.filename} (${u.wordCount} words)`).join(', ');
      context += `## Uploaded Manuscript\n\n`;
      context += `**Files**: ${fileList}\n\n`;
      // Include up to 30k chars of uploaded content for the AI to work with
      const uploaded = String(project.context.uploadedContent);
      if (uploaded.length > 30000) {
        context += uploaded.substring(0, 30000) + '\n\n[...truncated at 30,000 chars — full text available in workspace...]\n\n';
      } else {
        context += uploaded + '\n\n';
      }
    }

    // Inject Core Lessons from self-improvement analysis (if available)
    // These are distilled insights from all previous completed projects
    const coreLessons = await this.getCoreLessons();
    if (coreLessons) {
      context += `\n## Writing Lessons Learned\n\n${coreLessons}\n\n`;
    }

    // Add Author OS tool suggestion with actionable instructions
    if (step.toolSuggestion) {
      const toolInstructions: Record<string, string> = {
        'workflow-engine': 'Load the relevant JSON workflow template and follow its step sequence.',
        'book-bible': 'Use the Book Bible data for character/world consistency checks.',
        'manuscript-autopsy': 'Run manuscript analysis for pacing and structure feedback.',
        'format-factory': 'Use Format Factory Pro: python format_factory_pro.py <input> -t "Title" --all',
        'creator-asset-suite': 'Generate marketing assets using the Creator Asset Suite tools.',
        'ai-author-library': 'Reference writing prompts and voice markers from the library.',
      };
      context += `\n**Suggested Tool**: Author OS ${step.toolSuggestion}\n`;
      const instruction = toolInstructions[step.toolSuggestion];
      if (instruction) {
        context += `**How to use**: ${instruction}\n`;
      }
    }

    return context;
  }

  private buildKeywordBookContext(project: Project, step: ProjectStep): string {
    let context = '';
    const completed = project.steps.filter(s => s.status === 'completed' && s.result);
    const candidate = project.context?.selectedCandidate as KeywordBookCandidate | undefined;
    const targetWords = Number(project.context?.targetWords || 500000);
    const targetChapters = Number(project.context?.targetChapters || 0);
    const wordsPerChapter = Number(project.context?.targetWordsPerChapter || 4000);

    if (candidate) {
      context += `## 已选方案\n\n`;
      context += `- 标题：${candidate.title}\n`;
      context += `- 核心钩子：${candidate.hook}\n`;
      context += `- 核心设定：${candidate.premise}\n`;
      context += `- 目标读者：${candidate.audience}\n`;
      context += `- 卖点：${candidate.highlights.join('；')}\n\n`;
    }

    context += `## 项目目标\n\n`;
    context += `- 目标总字数：${targetWords.toLocaleString()}\n`;
    context += `- 目标章节数：${targetChapters}\n`;
    context += `- 每章目标字数：${wordsPerChapter.toLocaleString()}\n\n`;

    const truncate = (text: string, max: number) =>
      text.length > max ? text.slice(0, max) + '\n\n[...truncated...]' : text;

    const expansion = completed.find(s => s.phase === 'expansion');
    const outline = completed.find(s => s.phase === 'outline');

    switch (step.phase) {
      case 'expansion':
        break;
      case 'outline':
        if (expansion?.result) {
          context += `## 项目扩展稿\n\n${truncate(expansion.result, 5000)}\n\n`;
        }
        break;
      case 'draft': {
        if (expansion?.result) context += `## 项目扩展稿\n\n${truncate(expansion.result, 3500)}\n\n`;
        if (outline?.result) context += `## 章节概要\n\n${truncate(outline.result, 6000)}\n\n`;
        const revisedChapters = completed
          .filter(s => s.phase === 'revision' && s.chapterNumber)
          .sort((a, b) => (a.chapterNumber || 0) - (b.chapterNumber || 0));
        if (revisedChapters.length > 0) {
          const recent = revisedChapters.slice(-2);
          context += `## 最近已修订章节（连续性参考）\n\n`;
          for (const ch of recent) {
            context += `### ${ch.label}\n${truncate(ch.result || '', 2200)}\n\n`;
          }
        }
        break;
      }
      case 'revision': {
        if (outline?.result) context += `## 章节概要\n\n${truncate(outline.result, 5000)}\n\n`;
        const currentDraft = completed.find(s => s.phase === 'draft' && s.chapterNumber === step.chapterNumber);
        if (currentDraft?.result) {
          context += `## 当前章节草稿\n\n${truncate(currentDraft.result, 12000)}\n\n`;
        }
        break;
      }
      case 'assembly': {
        const stats = this.getProjectWordStats(project.id);
        context += `## 完成统计\n\n`;
        context += `- 已完成修订章节：${stats.completedChapters}\n`;
        context += `- 当前累计字数：${stats.totalWords.toLocaleString()}\n`;
        context += `- 是否达标：${stats.targetReached ? '是' : '否'}\n\n`;
        break;
      }
      default:
        for (const cs of completed.slice(-5)) {
          context += `### ${cs.label}\n${truncate(cs.result || '', 1500)}\n\n`;
        }
    }

    return context;
  }

  /**
   * Build phase-aware context for novel pipeline steps.
   * Each phase gets relevant prior outputs without overwhelming the context window.
   */
  private buildNovelPipelineContext(project: Project, step: ProjectStep): string {
    let context = '';
    const completed = project.steps.filter(s => s.status === 'completed' && s.result);

    const getPhaseResults = (phase: string) =>
      completed.filter(s => s.phase === phase);

    const truncate = (text: string, max: number) =>
      text.length > max ? text.slice(0, max) + '\n\n[...truncated...]' : text;

    switch (step.phase) {
      case 'premise': {
        // First premise step gets just the config; second gets first premise result
        const priorPremise = getPhaseResults('premise');
        if (priorPremise.length > 0) {
          context += `## Prior Premise Work\n\n${priorPremise.map(s => s.result).join('\n\n')}\n\n`;
        }
        break;
      }

      case 'bible': {
        // Bible steps get the full premise
        const premiseResults = getPhaseResults('premise');
        if (premiseResults.length > 0) {
          context += `## Premise\n\n${premiseResults.map(s => s.result).join('\n\n')}\n\n`;
        }
        // Plus any prior bible steps
        const priorBible = getPhaseResults('bible').filter(s => s.id !== step.id);
        if (priorBible.length > 0) {
          context += `## Book Bible (so far)\n\n`;
          for (const bs of priorBible) {
            context += `### ${bs.label}\n${truncate(bs.result!, 1500)}\n\n`;
          }
        }
        break;
      }

      case 'outline': {
        // Outline gets premise + summarized bible
        const premiseResults = getPhaseResults('premise');
        if (premiseResults.length > 0) {
          context += `## Premise\n\n${truncate(premiseResults.map(s => s.result).join('\n\n'), 3000)}\n\n`;
        }
        const bibleResults = getPhaseResults('bible');
        if (bibleResults.length > 0) {
          context += `## Book Bible\n\n`;
          for (const bs of bibleResults) {
            context += `### ${bs.label}\n${truncate(bs.result!, 1000)}\n\n`;
          }
        }
        // Prior outline steps
        const priorOutline = getPhaseResults('outline').filter(s => s.id !== step.id);
        if (priorOutline.length > 0) {
          context += `## Outline (so far)\n\n${priorOutline.map(s => s.result).join('\n\n')}\n\n`;
        }
        break;
      }

      case 'writing': {
        // Writing steps get: premise (brief) + bible (summaries) + outline + last 2 chapters (sliding window)
        const premiseResults = getPhaseResults('premise');
        if (premiseResults.length > 0) {
          context += `## Premise\n\n${truncate(premiseResults.map(s => s.result).join('\n\n'), 1500)}\n\n`;
        }
        const bibleResults = getPhaseResults('bible');
        if (bibleResults.length > 0) {
          context += `## Book Bible (key details)\n\n`;
          for (const bs of bibleResults) {
            context += `### ${bs.label}\n${truncate(bs.result!, 600)}\n\n`;
          }
        }
        // Full outline
        const outlineResults = getPhaseResults('outline');
        if (outlineResults.length > 0) {
          context += `## Outline\n\n${truncate(outlineResults.map(s => s.result).join('\n\n'), 4000)}\n\n`;
        }
        // Sliding window: last 2 completed chapter results
        const writtenChapters = getPhaseResults('writing');
        if (writtenChapters.length > 0) {
          const recent = writtenChapters.slice(-2);
          context += `## Recent Chapters (for continuity)\n\n`;
          for (const ch of recent) {
            context += `### ${ch.label}\n${truncate(ch.result!, 2000)}\n\n`;
          }
        }
        break;
      }

      case 'revision': {
        // Revision gets: bible summaries + outline summary + all chapter summaries
        const bibleResults = getPhaseResults('bible');
        if (bibleResults.length > 0) {
          context += `## Book Bible\n\n`;
          for (const bs of bibleResults) {
            context += `### ${bs.label}\n${truncate(bs.result!, 800)}\n\n`;
          }
        }
        const outlineResults = getPhaseResults('outline');
        if (outlineResults.length > 0) {
          context += `## Outline\n\n${truncate(outlineResults.map(s => s.result).join('\n\n'), 3000)}\n\n`;
        }
        // Brief summaries of all chapters
        const writtenChapters = getPhaseResults('writing');
        if (writtenChapters.length > 0) {
          context += `## Chapter Drafts (summaries)\n\n`;
          for (const ch of writtenChapters) {
            context += `### ${ch.label}\n${truncate(ch.result!, 500)}\n\n`;
          }
        }
        break;
      }

      case 'assembly': {
        // Assembly gets a brief overview of everything
        const totalWords = getPhaseResults('writing').reduce((sum, s) => {
          return sum + (s.result?.split(/\s+/).length || 0);
        }, 0);
        context += `## Pipeline Summary\n\n`;
        context += `- Chapters written: ${getPhaseResults('writing').length}\n`;
        context += `- Approximate total words: ${totalWords.toLocaleString()}\n`;
        context += `- Revision steps completed: ${getPhaseResults('revision').length}\n\n`;
        // Include consistency check results if available
        const consistencyCheck = completed.find(s => s.label === 'Consistency check');
        if (consistencyCheck?.result) {
          context += `## Consistency Check Results\n\n${truncate(consistencyCheck.result, 3000)}\n\n`;
        }
        break;
      }

      default: {
        // Fallback: include all prior results (truncated)
        for (const cs of completed) {
          context += `### ${cs.label}\n${truncate(cs.result!, 1000)}\n\n`;
        }
      }
    }

    return context;
  }

  // ── Smart Project from Natural Language ──

  /**
   * Infer the best project type from a natural language description.
   * Used when the user just says what they want without specifying a type.
   */
  inferProjectType(description: string): ProjectType {
    const lower = description.toLowerCase();

    if (lower.match(/\b(keyword|关键词|选题|长篇立项|网文|连载)\b/)) {
      return 'keyword-book-mvp';
    }

    // Novel pipeline signals — ONLY when explicitly asking for a full novel/book
    if (lower.match(/\b(novel|full book|write a book|write my book|entire book|complete novel|full manuscript|book from scratch|novel pipeline|write a complete)\b/)) {
      return 'novel-pipeline';
    }

    // Pipeline signals — wants the full production chain
    if (lower.match(/\b(pipeline|full production|end.?to.?end|planning through launch|all phases)\b/)) {
      return 'pipeline';
    }

    // Book Planning signals
    if (lower.match(/\b(plan|outline|structure|plot|brainstorm|concept|story map|beat sheet|premise|logline|synopsis)\b/)) {
      return 'book-planning';
    }

    // Book Bible signals
    if (lower.match(/\b(world.?build|book.?bible|bible|magic system|timeline|backstory|lore|character bible|continuity)\b/)) {
      return 'book-bible';
    }

    // Book Production signals
    if (lower.match(/\b(chapter|scene|prose|manuscript|draft|write.*chapter|write.*scene|book production)\b/)) {
      return 'book-production';
    }

    // Deep revision signals — must come before general revision
    if (lower.match(/\b(deep.?revis|deep.?edit|full.?revision|manuscript.?review|beta.?reader|comprehensive.?edit|revision.?pipeline|deep.?analysis|manuscript.?analysis|manuscript.?audit|edit.*book|revise|rewrite|feedback|critique|proofread|consistency)\b/)) {
      return 'deep-revision';
    }

    // Format & Export signals
    if (lower.match(/\b(export|format|compile|epub|pdf|docx|publish|kdp|kindle|front matter|back matter)\b/)) {
      return 'format-export';
    }

    // Book Launch signals
    if (lower.match(/\b(launch|blurb|amazon desc|keywords|ad copy|advertise|promote|market|social media|book description|categories)\b/)) {
      return 'book-launch';
    }

    // Default: let the AI planner figure out the best approach
    return 'custom';
  }

  /**
   * Create a full pipeline: chains all 6 project phases from a single idea.
   * Each phase is a separate sub-project linked by pipelineId.
   */
  createPipeline(
    title: string,
    description: string,
    personaId?: string,
    config?: NovelPipelineConfig
  ): { pipelineId: string; projects: Project[] } {
    const pipelineId = `pipeline-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
    const phases: Array<{ type: ProjectType; label: string; phaseNum: number }> = [
      { type: 'book-planning', label: `${title} — 策划`, phaseNum: 1 },
      { type: 'book-bible', label: `${title} — 设定集`, phaseNum: 2 },
      { type: 'book-production', label: `${title} — 制作`, phaseNum: 3 },
      { type: 'deep-revision', label: `${title} — 深度修订`, phaseNum: 4 },
      { type: 'format-export', label: `${title} — 格式与导出`, phaseNum: 5 },
      { type: 'book-launch', label: `${title} — 新书发布`, phaseNum: 6 },
    ];

    const projects: Project[] = [];
    for (const phase of phases) {
      let project: Project;
      if (phase.type === 'book-production') {
        // Book production uses the novel pipeline chapter-writing logic
        project = this.createBookProduction(phase.label, description, config);
      } else {
        project = this.createProject(phase.type, phase.label, description, { pipelineTitle: title, ...config });
      }
      project.pipelineId = pipelineId;
      project.pipelinePhase = phase.phaseNum;
      if (personaId) project.personaId = personaId;
      projects.push(project);
    }

    // Only the first phase starts as pending-ready; others wait
    // (Pipeline advancement is managed by the dashboard/API)
    this.persistState();
    return { pipelineId, projects };
  }

  /**
   * Create a Book Production project with dynamic chapter steps.
   */
  createBookProduction(title: string, description: string, config: NovelPipelineConfig = {}): Project {
    const id = `project-${this.nextId++}`;
    const now = new Date().toISOString();
    const chapters = Math.min(Math.max(config.targetChapters || 25, 1), 200);
    const wordsPerChapter = Math.max(config.targetWordsPerChapter || 4000, 100);

    const steps: ProjectStep[] = [];
    for (let ch = 1; ch <= chapters; ch++) {
      steps.push({
        id: `${id}-step-${ch * 2 - 1}`,
        label: `编写第 ${ch} 章`,
        phase: 'writing',
        skill: 'write',
        taskType: 'creative_writing',
        prompt: `编写“${title}”的第 ${ch} 章。\n\n说明：\n- 遵循本章的大纲节拍和设定集\n- 你必须写出至少 ${wordsPerChapter} 字的实际散文叙述\n- 以吸引人的钩子开篇 — 不要兜圈子\n- 以让读者想翻页的理由结束\n- 包含感官细节和内在张力\n- 将完整的章节写成实际的散文，而不是摘要\n\n${description}`,
        status: 'pending',
        wordCountTarget: wordsPerChapter,
        chapterNumber: ch,
      });
      steps.push({
        id: `${id}-step-${ch * 2}`,
        label: `自我审查第 ${ch} 章`,
        phase: 'writing',
        skill: 'revise',
        taskType: 'revision',
        prompt: `复查我们刚刚写的第 ${ch} 章。检查：声音的一致性、节奏、展示与讲述、对话质量、感官细节、目标字数（${wordsPerChapter}+）。提出改进建议，但专注于完成本章，而不是追求完美。`,
        status: 'pending',
        chapterNumber: ch,
      });
    }

    // Assembly step
    steps.push({
      id: `${id}-step-${chapters * 2 + 1}`,
      label: '编译手稿',
      phase: 'assembly',
      taskType: 'general',
      prompt: `生成“${title}”的完成报告。总章节数：${chapters}。目标：约 ${(chapters * wordsPerChapter).toLocaleString()} 字。评估优势、需要改进的地方以及后续步骤。`,
      status: 'pending',
    });

    const project: Project = {
      id,
      type: 'book-production',
      title,
      description,
      status: 'pending',
      progress: 0,
      steps,
      createdAt: now,
      updatedAt: now,
      context: {
        targetChapters: chapters,
        targetWordsPerChapter: wordsPerChapter,
        estimatedTotalWords: chapters * wordsPerChapter,
        ...config,
      },
    };

    this.projects.set(id, project);
    this.persistState();
    return project;
  }

  /**
   * Get all projects belonging to a pipeline.
   */
  getPipelineProjects(pipelineId: string): Project[] {
    return Array.from(this.projects.values())
      .filter(p => p.pipelineId === pipelineId)
      .sort((a, b) => (a.pipelinePhase || 0) - (b.pipelinePhase || 0));
  }

  // ── Core Lessons (self-improvement feedback loop) ──

  /**
   * Load Core Lessons from the self-improvement analysis file.
   * Cached for 5 minutes to avoid re-reading disk every step.
   * Returns null if no core lessons exist yet.
   */
  private async getCoreLessons(): Promise<string | null> {
    const now = Date.now();
    // Return cached version if less than 5 minutes old
    if (this.coreLessonsCache !== null && (now - this.coreLessonsCacheTime) < 300000) {
      return this.coreLessonsCache;
    }

    const coreLessonsPath = join(this.rootDir, 'workspace', '.agent', 'core-lessons.md');
    if (!existsSync(coreLessonsPath)) {
      this.coreLessonsCache = null;
      this.coreLessonsCacheTime = now;
      return null;
    }

    try {
      const content = await readFile(coreLessonsPath, 'utf-8');
      // Strip the header, just get the lessons content (max 1500 chars to not bloat context)
      const body = content.replace(/^#.*\n\n\*[^*]+\*\n\n/, '').trim();
      this.coreLessonsCache = body.length > 1500 ? body.substring(0, 1500) + '\n...' : body;
      this.coreLessonsCacheTime = now;
      return this.coreLessonsCache;
    } catch {
      this.coreLessonsCache = null;
      this.coreLessonsCacheTime = now;
      return null;
    }
  }

  // ── Private Helpers ──

  private expandTemplate(template: string, vars: Record<string, any>): string {
    let result = template;
    for (const [key, value] of Object.entries(vars)) {
      if (typeof value === 'string') {
        result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
      }
    }
    // Clean up any remaining unexpanded vars
    result = result.replace(/\{\{[^}]+\}\}/g, '');
    return result;
  }

  private inferTaskType(description: string): string {
    const type = this.inferProjectType(description);
    const taskMap: Record<ProjectType, string> = {
      'book-planning': 'outline',
      'book-bible': 'book_bible',
      'book-production': 'creative_writing',
      'deep-revision': 'revision',
      'format-export': 'general',
      'book-launch': 'marketing',
      'keyword-book-mvp': 'outline',
      'novel-pipeline': 'creative_writing',
      pipeline: 'general',
      custom: 'general',
    };
    return taskMap[type] || 'general';
  }

  private enhanceWithAuthorOS(steps: ProjectStep[]): ProjectStep[] {
    if (!this.authorOS) return steps;

    const availableTools = this.authorOS.getAvailableTools();
    return steps.map(step => {
      // If the step suggests a tool, check if it's available
      if (step.toolSuggestion && !availableTools.includes(step.toolSuggestion)) {
        // Tool not available — clear suggestion but keep the step
        step.toolSuggestion = undefined;
      }
      return step;
    });
  }

  private parseCandidatesResponse(text: string): KeywordBookCandidate[] {
    let cleaned = text.trim();
    cleaned = cleaned.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();
    let parsed: any = null;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      const jsonMatch = cleaned.match(/\{[\s\S]*"candidates"[\s\S]*\}/);
      if (jsonMatch) {
        try {
          parsed = JSON.parse(jsonMatch[0]);
        } catch {
          parsed = null;
        }
      }
    }

    const candidates = Array.isArray(parsed?.candidates) ? parsed.candidates.slice(0, 3) : [];
    return candidates.map((candidate: any, index: number) => ({
      id: `candidate-${index + 1}`,
      title: String(candidate?.title || `方案${index + 1}`),
      hook: String(candidate?.hook || ''),
      premise: String(candidate?.premise || ''),
      audience: String(candidate?.audience || ''),
      highlights: Array.isArray(candidate?.highlights)
        ? candidate.highlights.slice(0, 3).map((item: any) => String(item))
        : [],
    })).filter((candidate: KeywordBookCandidate) => candidate.title && candidate.premise);
  }

  private buildFallbackKeywordCandidates(keyword: string): KeywordBookCandidate[] {
    return [
      {
        id: 'candidate-1',
        title: `${keyword}：逆袭主线版`,
        hook: `围绕“${keyword}”打造强成长、强升级、强冲突的长篇故事。`,
        premise: `主角因“${keyword}”卷入一个不断升级的局势，从个人生存问题一路推进到更大的阵营冲突与命运选择，适合长线连载扩写。`,
        audience: '偏好成长、推进感和持续爽点的长篇读者',
        highlights: ['强主线推进', '易做阶段升级', '适合长篇连载'],
      },
      {
        id: 'candidate-2',
        title: `${keyword}：悬念解谜版`,
        hook: `用“${keyword}”做谜题核心，靠真相层层揭露驱动篇幅。`,
        premise: `以“${keyword}”为核心秘密，主角在调查、误导、反转中不断接近真相，每次揭晓都会带来新的关系变化和更高风险，适合章节尾钩子结构。`,
        audience: '喜欢反转、揭秘和悬念推进的读者',
        highlights: ['章节钩子强', '适合分卷揭秘', '节奏容易控制'],
      },
      {
        id: 'candidate-3',
        title: `${keyword}：群像关系版`,
        hook: `将“${keyword}”放进复杂人物关系网，靠阵营与情感冲突拉长篇幅。`,
        premise: `围绕“${keyword}”构建多人物、多立场、多阶段目标的叙事体系，让人物关系与利益博弈不断重组，从而支撑超长篇持续展开。`,
        audience: '偏爱人物群像、关系变化和世界展开的读者',
        highlights: ['群像可扩展', '世界观延展性高', '适合长线关系戏'],
      },
    ];
  }

  private enrichWithPriorResults(prompt: string, project: Project): string {
    // Prior step results are already included in buildProjectContext() system context.
    // Don't duplicate them in the user message — it wastes tokens and can confuse the AI.
    // Just add a brief note referencing the previous step so the AI knows to build on it.
    if (prompt.includes('we developed') || prompt.includes('we created')) {
      return prompt;
    }

    const lastCompleted = [...project.steps].reverse().find(s => s.status === 'completed' && s.result);
    if (lastCompleted) {
      return `[Build on the work from "${lastCompleted.label}" — see system context for details.]\n\n${prompt}`;
    }

    return prompt;
  }
}
