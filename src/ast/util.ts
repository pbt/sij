
type VTagged<Tag, T> = T & { __tag: Tag };
type Tagged<Tag, T> = T & { readonly _tag: Tag };
type UnTag<T> = Omit<T, '_tag'>;

const tag = <Tag, O extends {}>(tag: Tag, obj: O): Tagged<Tag, O> => ({ _tag: tag, ...obj });

type Extension = {
    expression: any,
    query: any,
};

type NoExtension = {
    expression: unknown,
    query: unknown,
};

const copy = <T extends {}>(obj: T, vals: Partial<T>): T => ({ ...obj, ...vals });

export {
    VTagged,
    Tagged,
    UnTag,
    tag,
    Extension,
    NoExtension,
    copy,
};