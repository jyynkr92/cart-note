import { screen } from '@testing-library/react-native';

type Node = { type: string; props: Record<string, unknown>; children: (Node | string)[] | null };

function flatten(node: Node | Node[] | null, out: Node[] = []): Node[] {
  if (!node) return out;
  if (Array.isArray(node)) {
    for (const n of node) flatten(n, out);
    return out;
  }
  out.push(node);
  for (const c of node.children ?? []) if (typeof c !== 'string') flatten(c, out);
  return out;
}

function text(node: Node): string {
  return (node.children ?? []).map((c) => (typeof c === 'string' ? c : text(c))).join('');
}

/** 화면에 그려진 순서에서 placeholder 입력란 바로 다음 요소(텍스트 포함)를 돌려준다. */
export function nodeAfterInput(placeholder: string): { role: unknown; text: string } | null {
  const nodes = flatten(screen.toJSON() as Node | Node[] | null);
  const i = nodes.findIndex((n) => n.props.placeholder === placeholder);
  const next = i >= 0 ? nodes[i + 1] : undefined;
  return next ? { role: next.props.accessibilityRole ?? next.props.role, text: text(next) } : null;
}
