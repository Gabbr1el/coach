import type { RoadmapModule } from '../../shared/contracts/roadmap-contract'

export type StudyStage = 'explanation' | 'example' | 'verification' | 'feedback' | 'exercise'

export interface StudyLesson {
  id: string
  concept: string
  whyItWorks: string
  steps: string[]
  example: string
  walkthrough: string[]
  verification: { id: string; question: string; options: string[]; correct: number; gaps: string[] }
  exercise: string
  success: string
  reinforcement: string
}

export function lessonFor(topic: string, module: RoadmapModule): StudyLesson {
  const topicId = `${module.id}:${topic}`
  const lessonId = `${topicId}:lesson`
  const checkpointId = `${lessonId}:checkpoint`
  if (/ponteiro|pointer/i.test(topic)) return {
    id: lessonId,
    concept: 'Uma variavel comum guarda um valor. Um ponteiro guarda o endereco de memoria onde outro valor esta armazenado.',
    whyItWorks: 'A memoria pode ser vista como posicoes numeradas. O operador & obtem o endereco de uma variavel; o operador * acessa o valor existente naquele endereco.',
    steps: ['int idade = 20 cria um inteiro na memoria.', 'int *p declara um ponteiro para inteiro.', 'p = &idade guarda em p o endereco de idade.', '*p le ou altera o valor de idade por meio desse endereco.'],
    example: 'int idade = 20;\nint *p = &idade;\nprintf("%d", *p);',
    walkthrough: ['idade recebe o valor 20.', '&idade produz o endereco dessa variavel.', 'p recebe esse endereco, nao o numero 20.', '*p segue o endereco e encontra 20, que e impresso.'],
    verification: { id: checkpointId, question: 'Depois de int n = 7; int *p = &n;, o que representa p?', options: ['O valor 7', 'O endereco de n', 'Uma copia independente de n'], correct: 1, gaps: ['diferenca entre valor e endereco', 'significado do operador &', 'relacao entre copia e referencia'] },
    exercise: 'Na Pratica, declare valor = 10, crie um ponteiro para ele, altere o valor para 25 por meio do ponteiro e imprima o resultado.',
    success: 'Voce distinguiu endereco de valor. Agora aplique & e * em uma pequena alteracao de memoria.',
    reinforcement: 'Pense em n como uma casa, &n como o endereco escrito em um papel e p como o papel que guarda esse endereco. O operador * visita a casa indicada no papel.',
  }
  if (/sintaxe|syntax/i.test(topic)) return {
    id: lessonId,
    concept: 'Sintaxe e o conjunto de regras que define como instrucoes validas sao escritas em Python.',
    whyItWorks: 'Antes de executar, o interpretador precisa reconhecer a estrutura do programa. Delimitadores abertos e instrucoes incompletas impedem essa leitura.',
    steps: ['O interpretador le o arquivo.', 'Ele organiza os simbolos em estruturas validas.', 'Se a estrutura estiver incompleta, gera SyntaxError antes da execucao.'],
    example: 'print("Ola")',
    walkthrough: ['print inicia uma chamada de funcao.', 'Os parenteses delimitam o argumento.', 'As aspas delimitam o texto; todos os pares sao fechados.'],
    verification: { id: checkpointId, question: 'Qual opcao tem uma estrutura que o interpretador nao consegue concluir?', options: ['print("Ola")', 'idade = 20', 'print("Ola"'], correct: 2, gaps: ['fechamento de parenteses', 'atribuicao valida', 'delimitacao de texto'] },
    exercise: 'Na Pratica, corrija print("Ola" e execute o arquivo para confirmar a saida.',
    success: 'Voce reconheceu uma estrutura incompleta. Agora confirme a correcao executando-a.',
    reinforcement: 'Leia os delimitadores em pares: cada ( precisa de ), cada [ de ] e cada aspas de outra aspas correspondente.',
  }
  return {
    id: lessonId,
    concept: module.objective,
    whyItWorks: `Este conteudo contribui para: ${module.outcomes.join('; ')}.`,
    steps: module.topics.slice(0, 4).map((item) => `Relacione ${item} ao objetivo do modulo.`),
    example: module.practice,
    walkthrough: ['Identifique a situacao inicial.', 'Aplique o conceito em uma etapa pequena.', 'Observe o resultado e compare com o criterio esperado.'],
    verification: { id: checkpointId, question: `Qual evidencia demonstra compreensao de ${topic}?`, options: [module.completionCriteria[0] ?? 'Aplicar e explicar o conceito', 'Somente abrir o topico', 'Copiar uma resposta sem verificar'], correct: 0, gaps: ['aplicacao verificavel', 'abertura sem aprendizagem', 'dependencia de resposta pronta'] },
    exercise: module.practice,
    success: 'A verificacao indica compreensao inicial. Consolide-a agora em uma aplicacao propria.',
    reinforcement: `Retome o objetivo por outra perspectiva: ${module.objective} Explique com suas palavras antes de tentar novamente.`,
  }
}

export function nextStudyStage(stage: StudyStage, correct?: boolean): StudyStage {
  if (stage === 'explanation') return 'example'
  if (stage === 'example') return 'verification'
  if (stage === 'verification') return correct ? 'exercise' : 'feedback'
  if (stage === 'exercise') return 'feedback'
  return correct ? 'feedback' : 'verification'
}
