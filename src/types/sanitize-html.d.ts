/**
 * Minimal local types for sanitize-html 2.18.1 (the package ships no types, and no @types package is added).
 * Only the options used by src/app/api/admin/comm/_lib/doc-sanitize.ts are declared.
 */
declare module "sanitize-html" {
  type AllowedAttribute = string | { name: string; multiple?: boolean; values: string[] };
  interface IOptions {
    allowedTags?: string[] | false;
    allowedAttributes?: Record<string, AllowedAttribute[]> | false;
    allowedStyles?: Record<string, Record<string, RegExp[]>>;
    allowedSchemes?: string[];
    allowedSchemesByTag?: Record<string, string[]>;
    allowProtocolRelative?: boolean;
    allowedClasses?: Record<string, string[] | boolean>;
    allowVulnerableTags?: boolean;
    disallowedTagsMode?: "discard" | "escape" | "recursiveEscape" | "completelyDiscard";
    nonTextTags?: string[];
    nestingLimit?: number;
    enforceHtmlBoundary?: boolean;
    parser?: { lowerCaseTags?: boolean; lowerCaseAttributeNames?: boolean; decodeEntities?: boolean };
    transformTags?: Record<string, (tagName: string, attribs: Record<string, string>) => { tagName: string; attribs: Record<string, string> }>;
    onOpenTag?:(name: string, attribs: Record<string, string>) => void;
    onCloseTag?: (name: string, isImplied: boolean) => void;
  }
  function sanitizeHtml(dirty: string, options?: IOptions): string;
  export default sanitizeHtml;
}
