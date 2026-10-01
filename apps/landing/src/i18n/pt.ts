import type { LandingCopy } from "./en.ts";

export const pt: LandingCopy = {
  meta: {
    title: "COLD FORGE — Enquanto eles hibernam, você se forja",
    description:
      "O tracker do Winter Arc. 92 dias, de 1º de outubro a 31 de dezembro: banho gelado, treino, leitura, acordar cedo. Um toque por dia, sequências, ranks e cards prontos para os stories. Grátis, sem conta e offline.",
    ogLocale: "pt_BR",
  },
  a11y: {
    skip: "Pular para o conteúdo",
    home: "Início do COLD FORGE",
    mainNav: "Principal",
    language: "Idioma",
    forgeGrid: "Grade de 92 dias que vai do gelo à brasa",
    storyCard: "Exemplo de card para os stories",
    privacy: "Privacidade",
  },
  nav: {
    deal: "O pacto",
    arc: "Os 92 dias",
    faq: "Dúvidas",
    cta: "Comece seu arc",
  },
  hero: {
    eyebrow: "01.10 — 31.12 · {days} DIAS",
    titleA: "Enquanto eles",
    titleB: "hibernam,",
    titleC: "você se forja.",
    sub: "92 dias de frio, disciplina e silêncio. Chegue em janeiro como outra pessoa.",
    start: "Comece seu Winter Arc",
    apk: "Baixar APK",
    trust: "Grátis · sem conta · funciona offline",
    countdown: {
      fallback: "dias · de 1º de outubro a 31 de dezembro",
      toJan: "dias para 1º de janeiro",
      toJanOne: "dia para 1º de janeiro",
      day: "Dia {day} de {total}",
      toArc: "dias para o Winter Arc",
      toArcOne: "dia para o Winter Arc",
      toNext: "dias para o próximo Winter Arc",
    },
  },
  deal: {
    kicker: "O pacto",
    lines: ["Água gelada às 6:00.", "Treino quando ninguém vê.", "Páginas em vez de telas.", "Zero desculpas"],
    end: "até 31 de dezembro.",
    body: "Ninguém vai fazer isso por você. O COLD FORGE só pede uma coisa: aparecer todo dia e marcar. A constância faz o resto.",
  },
  phases: {
    titleA: "Três meses.",
    titleB: "Três versões de você.",
    sub: "O arc não é linear. No começo dói, depois vira rotina e, no fim, você já é outra pessoa.",
    range: "{month} · dias {from}–{to}",
    milestone: "Dia {n} · {title}",
    milestonesLabel: "Marcos",
    items: [
      {
        month: "Outubro",
        title: "O choque",
        body: "A água queima, o despertador pesa. É aqui que a maioria desiste. Sua meta: a primeira semana completa.",
      },
      {
        month: "Novembro",
        title: "A rotina",
        body: "Você para de negociar consigo mesmo. A escuridão chega mais cedo e você já está em movimento.",
      },
      {
        month: "Dezembro",
        title: "A forja",
        body: "Enquanto todo mundo promete “ano que vem”, você já fez. Você fecha o ano com provas.",
      },
    ],
  },
  forge: {
    titleA: "Do gelo",
    titleB: "à",
    titleC: "brasa.",
    sub: "Cada quadrado é um dia do seu arc. Eles começam frios. Cada dia cumprido os aquece. Em dezembro, sua grade deveria estar em chamas.",
    features: [
      "Marque seus hábitos com um toque",
      "Sequências por hábito e dias perfeitos",
      "{count} ranks, de {from} a {to}",
      "Cards 9:16 feitos para os stories",
    ],
  },
  proof: {
    titleA: "Provas,",
    titleB: "não promessas.",
    body: "Todo mundo diz que este ano vai. Você vai mostrar, dia após dia. Com um toque, seu progresso vira um story pronto para postar.",
    note: "Exemplo ilustrativo",
    streak: "sequência de {days}",
  },
  privacy: {
    items: [
      { title: "Sem conta", body: "Tudo fica salvo no seu celular." },
      { title: "Offline", body: "Na academia, no metrô, na montanha." },
      { title: "Sem anúncios", body: "Nada te tira do foco." },
      { title: "Sincronize se quiser", body: "Com o Google, entre seus dispositivos." },
    ],
  },
  faq: {
    title: "Dúvidas",
    items: [
      {
        q: "O que é o Winter Arc?",
        a: "Um desafio de 92 dias, de 1º de outubro a 31 de dezembro: construir disciplina enquanto o resto do mundo desacelera. Você escolhe os hábitos — banho gelado, treino, leitura, acordar cedo, o que te deixar mais difícil de quebrar.",
      },
      {
        q: "Posso começar atrasado?",
        a: "Pode. Entre no arc oficial quando quiser ou comece seus próprios 92 dias a partir de hoje.",
      },
      {
        q: "Preciso de conta?",
        a: "Não. Funciona completo sem cadastro. Entre com o Google só se quiser sincronizar entre dispositivos — seu progresso local vem junto.",
      },
      {
        q: "Quanto custa?",
        a: "Nada. O app web e o APK para Android são grátis e sem anúncios.",
      },
      {
        q: "App web ou APK?",
        a: "É o mesmo app, com as mesmas funções. O app web instala pelo navegador (Android: “Instalar app”; iPhone: Compartilhar → “Adicionar à Tela de Início”), se atualiza sozinho e funciona offline. O APK é a versão Android das nossas releases no GitHub, caso você prefira um arquivo de app clássico.",
      },
      {
        q: "O que acontece com meus dados?",
        a: "Sem conta, tudo fica no seu dispositivo. Se você entrar, seus hábitos e check-ins ficam num espaço privado na nuvem que só você pode ler. Nada é vendido e os cards só são compartilhados quando você compartilha. Você pode exportar seus dados quando quiser.",
      },
    ],
  },
  cta: {
    kicker: "1º de janeiro vai chegar de qualquer jeito",
    titleA: "Quem você vai ser",
    titleB: "quando ele chegar?",
    start: "Começar agora — é grátis",
    apk: "ou baixe o APK para Android",
  },
};
