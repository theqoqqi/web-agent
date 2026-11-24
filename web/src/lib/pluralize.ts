export type PluralForms = [one: string, few: string, many: string];

export function pluralize(
    count: number,
    forms: PluralForms,
): string {
    return `${count} ${pluralizeWord(count, forms)}`;
}

export function pluralizeWord(
    count: number,
    [one, few, many]: PluralForms,
): string {
    const abs = Math.abs(count);
    const remainder10 = abs % 10;
    const remainder100 = abs % 100;

    if (remainder100 >= 11 && remainder100 <= 19) {
        return many;
    }

    if (remainder10 === 1) {
        return one;
    }

    if (remainder10 >= 2 && remainder10 <= 4) {
        return few;
    }

    return many;
}
