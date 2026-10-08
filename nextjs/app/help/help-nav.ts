export interface HelpArticle {
    /** Static route of the article page. */
    href: string;
    /** Full title — the landing cards and page metadata. */
    title: string;
    /** Short title — the sidebar / mobile chip. */
    navTitle: string;
    /** One-line summary for the landing card. */
    description: string;
}

// The documentation articles. Shared by the help sidebar (help-shell)
// and the /help landing cards. Routes must stay static (ADR-25) and be
// listed in lib/offline/routes.ts.
export const HELP_ARTICLES: HelpArticle[] = [
    {
        href: "/help/tenants",
        title: "Сообщества и клубы",
        navTitle: "Сообщества и клубы",
        description:
            "Что такое сообщество и клуб, как членство определяется клубами, как работает открытость (все партии / есть участник / только участники) и что остаётся общим.",
    },
    {
        href: "/help/elo",
        title: "Рейтинг Эло в настольных играх",
        navTitle: "Рейтинг Эло",
        description:
            "Что такое рейтинг Эло, по каким формулам он считается, каким играм подходит и как выглядит расчёт. Интерактивный пример.",
    },
    {
        href: "/help/arenas",
        title: "Арены и лиги",
        navTitle: "Арены и лиги",
        description:
            "Главная арена сообщества и игровые арены, лиги и условия перехода между ними, как устроен рейтинг новичков и когда он сойдётся с эло.",
    },
    {
        href: "/help/markets",
        title: "Рынок предсказаний",
        navTitle: "Рынок предсказаний",
        description:
            "Ставки рейтинга на исходы: типы рынков, роль поручителей, алгоритм маркет-мейкера и интерактивный тренажёр рынка.",
    },
    {
        href: "/help/tournaments",
        title: "Турниры",
        navTitle: "Турниры",
        description:
            "Турниры: запись участников, планы сеток, столы и партии, автоматическая арена. Пример турнира с двойным выбыванием.",
    },
    {
        href: "/help/rules",
        title: "Цели и правила использования",
        navTitle: "Цели и правила",
        description:
            "Зачем рейтингу существовать, как использовать его дружелюбно и кто вносит результаты партий.",
    },
];
