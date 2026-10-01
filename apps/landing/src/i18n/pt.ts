import type { LandingCopy } from "./en.ts";

/** Brazilian Portuguese. */
export const pt: LandingCopy = {
  meta: {
    title: "COLD FORGE — Acompanhe seu Winter Arc",
    description:
      "92 dias. De 1º de out a 31 de dez. Banho gelado, academia, leitura, acordar cedo. Marque seus hábitos com um toque, mantenha a sequência e mostre tudo com cards prontos para os stories.",
    ogLocale: "pt_BR",
  },
  a11y: {
    skip: "Pular para o conteúdo",
    home: "Início do COLD FORGE",
    language: "Idioma",
    mainNav: "Principal",
    phoneMock: "Prévia da tela Hoje do COLD FORGE",
    cardMock: "Exemplo de card para stories do COLD FORGE",
  },
  nav: {
    how: "Como funciona",
    features: "Recursos",
    ranks: "Níveis",
    faq: "Dúvidas",
    cta: "Abrir o app",
  },
  hero: {
    eyebrow: "O app do Winter Arc",
    titleA: "Forje-se",
    titleB: "neste inverno.",
    sub: "92 dias de banho gelado, treino pesado, despertador cedo e páginas lidas. O COLD FORGE transforma cada check-in em calor — e cada sequência em algo que dá orgulho de postar.",
    openApp: "Abrir o app web",
    openAppNote: "Instala como um app · funciona offline · sem loja",
    apk: "Baixar APK",
    apkPlatform: "Android",
    apkNote: "Prefere o app web? É o mesmo app.",
    storesLater: "App Store e Google Play: mais pra frente.",
    countdown: {
      label: "Winter Arc",
      fallback: "1º out → 31 dez · 92 dias",
      upcoming: "Faltam {n} dias para o Winter Arc",
      upcomingOne: "O Winter Arc começa amanhã",
      upcomingSub: "Começa em 1º de outubro. Escolha seus hábitos agora.",
      active: "Dia {day} de {total}",
      activeSub: "Faltam {n} dias de forja. Entre quando quiser.",
      activeSubLast: "Último dia. Termine forte.",
      finished: "O arc acabou. Até o próximo inverno.",
      finishedSub: "Faltam {n} dias para o próximo.",
    },
  },
  phone: {
    today: "Hoje",
    heat: "Calor da forja",
    done: "{done}/{total} feitos",
    tap: "Toque para forjar",
  },
  how: {
    kicker: "Como funciona",
    title: "Menos planejamento. Mais forja.",
    steps: [
      {
        title: "Escolha seus hábitos em 60 segundos",
        body: "Comece com modelos testados do Winter Arc ou crie os seus. Sem conta, sem configuração sem fim.",
      },
      {
        title: "Um toque por dia",
        body: "Abriu, tocou, pronto. Faíscas voam, o celular vibra e a forja esquenta.",
      },
      {
        title: "Mostre tudo nos stories",
        body: "Seu dia, sua sequência e seu nível num card 9:16 pronto para os stories.",
      },
    ],
  },
  features: {
    kicker: "Recursos",
    title: "Feito para 92 dias de disciplina.",
    items: {
      checkins: {
        title: "Check-in com um toque",
        body: "Faíscas e vibração a cada toque. Marcar um hábito leva menos tempo que ler isto.",
      },
      streaks: {
        title: "Sequências e dias perfeitos",
        body: "Cada hábito tem sua própria sequência. Cumpra todos e o dia conta como perfeito.",
      },
      heatmap: {
        title: "Mapa de calor de 92 dias",
        body: "Seu arc inteiro num relance — veja a grade passar de fria a incandescente.",
      },
      ranks: {
        title: "Níveis de forja",
        body: "Suba de {from} a {to} acumulando dias perfeitos.",
      },
      cards: {
        title: "Cards para stories",
        body: "Dia, sequência, nível e mapa de calor num card 9:16 caprichado.",
      },
      reminders: {
        title: "Lembretes",
        body: "Um toque no horário que você escolher, para a sequência nunca morrer por descuido.",
      },
      offline: {
        title: "Funciona offline",
        body: "No modo avião, no subsolo da academia, em qualquer lugar. Sem conta: entre com o Google só se quiser sincronizar.",
      },
      languages: {
        title: "3 idiomas",
        body: "English, Español e Português — troque quando quiser.",
      },
    },
  },
  ranks: {
    kicker: "Níveis de forja",
    title: "De minério bruto a forjado no gelo.",
    sub: "Os níveis vêm com dias perfeitos: dias em que você marcou todos os hábitos. Sem atalhos.",
    perfectDays: "{n} dias perfeitos",
    start: "Todo mundo começa aqui",
  },
  share: {
    kicker: "Cards para compartilhar",
    title: "Provas, não promessas.",
    sub: "Um toque transforma seu progresso num card do tamanho de um story. Poste, marque a galera e cobrem uns aos outros.",
    points: [
      "Formato 9:16 para stories do Instagram, TikTok e WhatsApp",
      "Cards especiais nos dias de marco",
      "Seus dados, sua decisão — nada é postado sem você",
    ],
    cardArc: "Winter Arc",
    streakDays: "{n} dias",
  },
  habits: {
    kicker: "Ideias de hábitos",
    title: "Junte os hábitos que te dão medo.",
    sub: "Comece com um modelo ou adicione os seus. A maioria forja de 3 a 5.",
    custom: "Seu próprio hábito",
  },
  milestones: {
    kicker: "Marcos",
    title: "Conquistas que merecem comemoração.",
    sub: "Bateu um marco, ganhou um card especial para compartilhar.",
    day: "Dia {n}",
  },
  faq: {
    kicker: "Dúvidas",
    title: "Perguntas frequentes.",
    items: [
      {
        q: "O que é o Winter Arc?",
        a: "Um desafio de evolução pessoal de 92 dias, de 1º de outubro a 31 de dezembro. Enquanto todo mundo hiberna, você constrói hábitos: banho gelado, treino, leitura, acordar cedo — o que te deixar mais difícil de quebrar.",
      },
      {
        q: "O COLD FORGE é grátis?",
        a: "Sim. O acompanhamento, as sequências, os ranks e os cards são grátis. Se um dia tiver extras, o essencial continua grátis.",
      },
      {
        q: "Como eu instalo?",
        a: "Abra o app web. Android (Chrome): toque em “Instalar app” ou ⋮ → “Instalar app”. iPhone/iPad (Safari): toque em Compartilhar → “Adicionar à Tela de Início”. Computador (Chrome ou Edge): clique no ícone de instalar na barra de endereço. Depois ele abre em tela cheia pela tela de início ou dock, como qualquer app.",
      },
      {
        q: "App web ou APK?",
        a: "É o mesmo app, com as mesmas funções. O app web instala em segundos, se atualiza sozinho e funciona em qualquer celular ou computador. O APK é a versão Android das nossas releases no GitHub, caso você prefira um arquivo de app clássico; o Android vai pedir para permitir instalações pelo navegador.",
      },
      {
        q: "Preciso de conta?",
        a: "Não. O COLD FORGE funciona completo sem conta (modo convidado). Entre com o Google só se quiser sincronizar seu arc entre dispositivos: dá pra fazer a qualquer momento e seu progresso local vem junto.",
      },
      {
        q: "O que acontece com meus dados?",
        a: "Sem conta, tudo fica no seu dispositivo e funciona offline. Se você entrar, seus hábitos e check-ins ficam no seu espaço privado na nuvem, que só você pode ler. Sem anúncios, nada é vendido e os cards só são compartilhados quando você compartilha. Você pode exportar seus dados quando quiser.",
      },
      {
        q: "Posso começar atrasado?",
        a: "Com certeza. Entre no arc clássico em qualquer dia ou comece seu próprio arc de “meus 92 dias a partir de hoje” quando estiver pronto.",
      },
      {
        q: "Quais idiomas ele suporta?",
        a: "Inglês, espanhol e português. Ele segue o idioma do seu dispositivo e você pode trocar quando quiser.",
      },
    ],
  },
  install: {
    kicker: "Baixe o app",
    title: "Instala em segundos. Sem loja.",
    sub: "O COLD FORGE é um app web que você pode instalar: abre em tela cheia pela tela de início, funciona offline e se atualiza sozinho.",
    open: "Abrir o app web",
    apk: "Baixar APK (Android)",
    apkNote: "Prefere o app web? É o mesmo app.",
    guest: "Sem conta. Entrar com o Google é opcional, só para sincronizar entre dispositivos.",
    platforms: [
      {
        name: "Android",
        steps: ["Abra o app web no Chrome.", "Toque em “Instalar app” (ou ⋮ → “Instalar app”).", "Encontre o COLD FORGE na tela de início."],
      },
      {
        name: "iPhone e iPad",
        steps: ["Abra o app web no Safari.", "Toque em Compartilhar e depois em “Adicionar à Tela de Início”.", "Toque em “Adicionar” e pronto."],
      },
      {
        name: "Computador",
        steps: ["Abra o app web no Chrome ou Edge.", "Clique no ícone de instalar na barra de endereço.", "Abra pelo dock ou menu iniciar."],
      },
    ],
  },
  footer: {
    line: "Feito para os meses frios.",
    rights: "Todos os direitos reservados.",
    top: "Voltar ao topo",
  },
};
