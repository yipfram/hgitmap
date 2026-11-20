const SLUG_PATTERN = /^[a-z0-9]+(?:-+[a-z0-9]+)*$/;

export const SLUG_HINT =
  'Use lowercase letters, digits and hyphens only; no leading or trailing hyphen.';

export function slugify(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
}

export function isValidSlug(slug) {
  return slug.length > 0 && slug.length <= 100 && SLUG_PATTERN.test(slug);
}
