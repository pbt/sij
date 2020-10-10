import CallableInstance from 'callable-instance';
import { lens } from 'lens.ts';

import { Expr, Ident, CompoundIdentifier, Lit } from '../ast/expr';
import { DataType } from '../ast/data-type';
import {
    AliasedSelection,
    AnonymousSelection,
    CommonTableExpr,
    Join,
    JoinKind,
    JoinedTable,
    OrderingExpr,
    Query,
    Select,
    SetOp,
    TableAlias,
} from '../ast/query';
import {
    Literal,
    NumLit,
    StringLit,
    BoolLit,
    NullLit,
} from '../ast/literal';
import { Extension, NoExtension, VTagged } from '../ast/util';
import { TypedAst, Functions } from './functions';

export type SubBuilder<T, R> = R | ((t: T) => R);

export type TypedAlias<Schema, Return, Col extends string, Ext extends Extension> =
    AliasedSelection<Ext> & { __schemaType: Schema, __returnType: Return };

class Builder<Schema, Ext extends Extension = NoExtension> {

    from<Table extends ((keyof Schema) & string)>(table: Table): QueryBuilder<Schema, Schema[Table], Table, {}, Ext> {
        const select = Select({
            selections: [],
            from: JoinedTable({ name: Ident(table), joins: [] }),
            where: null,
            groupBy: [],
            having: null,
            extensions: null
        });
        const query = Query({
            commonTableExprs: [],
            selection: select,
            unions: [],
            ordering: [],
            limit: null,
            offset: null,
            extensions: null,
        });
        return new QueryBuilder<Schema, Schema[Table], Table, {}, Ext>(query, new Functions());
    }

    insertInto<Table extends ((keyof Schema) & string)>(table: Table) {
    }

    update<Table extends ((keyof Schema) & string)>(table: Table) {
    }

    deleteFrom<Table extends ((keyof Schema) & string)>(table: Table) {
    }

    /**
     * Aliases an expression for use in a select.
     */
    as<Col extends string, R>(name: Col, expr: TypedAst<Schema, R, Expr<Ext>>) {
        return AliasedSelection({
            selection: expr,
            alias: Ident(name),
        }) as TypedAlias<Schema, R, Col, Ext>;
    }

    /**
     * Allows you to pass a raw bit of AST into the query.
     * You must provide the type of this expression.
     */
    ast<Return>(e: Expr<Ext>): TypedAst<Schema, Return, Expr<Ext>>{
        return e as TypedAst<Schema, Return, Expr<Ext>>
    }

    /**
     * Allows you to insert a literal into the query.
     */
    lit<Return extends number | string | boolean | null>(l: Return): TypedAst<Schema, Return, Expr<Ext>>{
        const lit = (() => {
            if (typeof l === 'number') {
                return NumLit(l);
            } else if (typeof l === 'string') {
                return StringLit(l);
            } else if (typeof l === 'boolean') {
                return BoolLit(l);
            } else {
                return NullLit;
            }
        })();
        return Lit(lit) as unknown as TypedAst<Schema, Return, Expr<Ext>>
    }
}

type ColumnFinal<P> =
    P extends `${infer Key}.${infer Rest}` ? Rest : never;

type ColumnInit<P> =
    P extends `${infer Key}.${infer Rest}` ? Key : never;

export type StringKeys<T> = (keyof T) extends string ? keyof T : never;
export type QualifiedIds<Schema, Tn extends ((keyof Schema) & string)> = ({ [K in Tn]: `${K}.${StringKeys<Schema[K]>}` })[Tn];
// Need to carry this out or the constraint is lost in the .d.ts files
export type ValuesOf<Schema, Table, Tn extends ((keyof Schema) & string), Ext extends Extension, Id, C, K extends [any, any]> =
    C extends Id ? Table[K[0]]
    : C extends QualifiedIds<Schema, Tn> ? Schema[K[1]][K[0]]
    : C extends TypedAlias<Schema, any, any, Ext> ? K[1]
    : never;

/**
 * Builds a SELECT statement.
 */
class QueryBuilder<Schema, Table, Tn extends ((keyof Schema) & string), Return, Ext extends Extension = NoExtension> extends CallableInstance<Array<unknown>, unknown> {

    constructor(readonly _query: Query, readonly fn: Functions<Schema, Table, Tn, Ext>) {
        super('apply');
    }

    apply<T>(fn: (arg: QueryBuilder<Schema, Table, Tn, Return, Ext>) => T): T {
        return fn(this);
    }

    /**
     * Select a single column or expression and alias it to `alias`.
     * `SELECT [col] AS [alias]`
     */
    selectAs<
        Id extends ((keyof Table) & string),
        Comp extends ({ [K in Tn]: `${K}.${StringKeys<Schema[K]>}` })[Tn],
        Exp extends TypedAst<Schema, any, Expr<Ext>>,
        Col extends Id | Comp | Exp,
    >(
        alias: string, col: Col
    ) {
        const selection = (() => {
            if (typeof col === 'object') {
                return AliasedSelection({
                    selection: col as unknown as Expr<Ext>,
                    alias: Ident(alias),
                }) as TypedAlias<Schema, any, any, Ext>;
            }
            return col;
        })();
        return this.select(selection as any);
    }

    /**
     * Select columns or expressions. You can *either* select columns *or* expressions
     * but not both. If you need select both, split your selections across multiple
     * calls to `select`.
     */
    select<
        Id extends ((keyof Table) & string),
        Comp extends ({ [K in Tn]: `${K}.${StringKeys<Schema[K]>}` })[Tn],
        Exp extends TypedAlias<Schema, any, any, Ext>,
        Col extends Id | Comp | Exp,
    >(
        ...cols: Array<Col>
    ) {
        const selections = cols.map(c => {
            if (typeof c === 'object') {
                return c as AliasedSelection<Ext>;
            }
            const idParts = (c as string).split('.');
            if (idParts.length === 1) {
                return AnonymousSelection(Ident(idParts[0] as string));
            } else {
                return AnonymousSelection(CompoundIdentifier(idParts.map(Ident)));
            }
        });
        type KeysOf<C> =
            C extends Id ? [C, any]
            : C extends Comp ? [ColumnFinal<C>, ColumnInit<C>]
            : C extends  TypedAlias<Schema, infer R, infer C, Ext> ? [C, R]
            : never;

        type ValuesOf1<C, K extends [any, any]> = ValuesOf<Schema, Table, Tn, Ext, Id, C, K>;

        type NewReturn = { [K in KeysOf<Col> as K[0]]: ValuesOf1<Col, K> } & Return;
        // Pick up any new aliases
        type NewTable = { [K in KeysOf<Col> as K[0]]: ValuesOf1<Col, K> } & Table;
        if (this._query.unions.length === 0) {
            return new QueryBuilder<Schema, NewTable, Tn, NewReturn, Ext>(
                lens<Query>().selection.selections.set(s => [...s, ...selections])(this._query),
                this.fn,
            );
        }
        const numUnions = this._query.unions.length;
        const currentUnion = this._query.unions[numUnions - 1];

        const newUnion = lens<SetOp<any>>().select.selections.set(s => [...s, ...selections])(currentUnion);

        return new QueryBuilder<Schema, NewTable, Tn, NewReturn, Ext>(
            lens<Query>().unions.set(u => [...u.slice(0, numUnions - 1), newUnion])(this._query),
            this.fn,
        );
    }

    // TODO join on expressions
    /**
     * `[kind] JOIN [table] ON [on]`
     *
     * @param on Expression to condition the join on. If using Typescript, this must be provided
     *        as a function from the builder to your ON expression so that you have the extra
     *        columns from the join available on the builder.
     */
    join<T2 extends keyof Schema & string>(
        kind: JoinKind,
        table: T2,
        on: SubBuilder<QueryBuilder<Schema, Table & Schema[T2], Tn | T2, Return, Ext>, TypedAst<Schema, any, Expr<Ext>>>,
    ): QueryBuilder<Schema, Table & Schema[T2], Tn | T2, Return, Ext> {
        const on_ = on instanceof Function ? on(this) : on;
        const newJoin = Join({
            name: Ident(table),
            kind: kind,
            on: on_,
        });
        return new QueryBuilder<Schema, Table & Schema[T2], Tn | T2, Return, Ext>(
            lens<Query>().selection.from.joins.set(js => [...js, newJoin])(this._query),
            this.fn
        );
    }

    /**
     * `LEFT OUTER JOIN [table] ON [on]`
     */
    leftJoin<T2 extends keyof Schema & string>(
        table: T2,
        on: SubBuilder<QueryBuilder<Schema, Table & Schema[T2], Tn | T2, Return, Ext>, TypedAst<Schema, any, Expr<Ext>>>,
    ) {
        return this.join('LEFT OUTER', table, on);
    }

    /**
     * `RIGHT OUTER JOIN [table] ON [on]`
     */
    rightJoin<T2 extends keyof Schema & string>(
        table: T2,
        on: SubBuilder<QueryBuilder<Schema, Table & Schema[T2], Tn | T2, Return, Ext>, TypedAst<Schema, any, Expr<Ext>>>,
    ) {
        return this.join('RIGHT OUTER', table, on);
    }

    /**
     * `FULL OUTER JOIN [table] ON [on]`
     */
    fullOuterJoin<T2 extends keyof Schema & string>(
        table: T2,
        on: SubBuilder<QueryBuilder<Schema, Table & Schema[T2], Tn | T2, Return, Ext>, TypedAst<Schema, any, Expr<Ext>>>,
    ) {
        return this.join('FULL OUTER', table, on);
    }

    /**
     * `INNER JOIN [table] ON [on]`
     */
    innerJoin<T2 extends keyof Schema & string>(
        table: T2,
        on: SubBuilder<QueryBuilder<Schema, Table & Schema[T2], Tn | T2, Return, Ext>, TypedAst<Schema, any, Expr<Ext>>>,
    ) {
        return this.join('INNER', table, on);
    }

    with<Table2, Tn2 extends string>(
        alias: Tn2,
        sub: QueryBuilder<Schema, any, Tn, Return, Ext>,
    ): QueryBuilder<Schema & { [Key in Tn2]: Table2 }, any, Tn | Tn2, Return, Ext> {
        const tAlias = TableAlias({ name: Ident(alias), columns: [] });
        const newCte = CommonTableExpr({ alias: tAlias, query: sub._query });
        return new QueryBuilder<Schema & { [Key in Tn2]: Table2 }, any, Tn | Tn2, Return, Ext>(
            lens<Query>().commonTableExprs.set(ctes => [...ctes, newCte])(this._query),
            new Functions(),
        );
    }

    orderBy<
        Id extends ((keyof Table) & string),
        Comp extends ({ [K in Tn]: `${K}.${StringKeys<Schema[K]>}` })[Tn],
        Exp extends Expr<Ext>,
        Col extends Id | Comp | Exp,
    >(
        col: Col,
        opts?: { order?: 'ASC' | 'DESC', nullHandling?: 'NULLS FIRST' | 'NULLS LAST' },
    ) {
        const expr = (() => {
            if (typeof col === 'object') {
                return col as Expr<Ext>;
            }
            const idParts = (col as string).split('.');
            if (idParts.length === 1) {
                return Ident(idParts[0] as string);
            } else {
                return CompoundIdentifier(idParts.map(Ident));
            }
        })();
        const newOrder = OrderingExpr({
            expr,
            order: opts?.order ?? null,
            nullHandling: opts?.nullHandling ?? null,
        });
        return new QueryBuilder<Schema, Table, Tn, Return, Ext>(
            lens<Query>().ordering.set(os => [...os, newOrder])(this._query),
            this.fn
        );
    }

    orderByAsc<
        Id extends ((keyof Table) & string),
        Comp extends ({ [K in Tn]: `${K}.${StringKeys<Schema[K]>}` })[Tn],
        Exp extends Expr<Ext>,
        Col extends Id | Comp | Exp,
    >(
        col: Col,
        opts?: { nullHandling?: 'NULLS FIRST' | 'NULLS LAST' },
    ) {
        const subOpts = { ...(opts ?? {}), order: ('ASC' as 'ASC') }
        this.orderBy(col, subOpts);
    }

    orderByDesc<
        Id extends ((keyof Table) & string),
        Comp extends ({ [K in Tn]: `${K}.${StringKeys<Schema[K]>}` })[Tn],
        Exp extends Expr<Ext>,
        Col extends Id | Comp | Exp,
    >(
        col: Col,
        opts?: { nullHandling?: 'NULLS FIRST' | 'NULLS LAST' },
    ) {
        const subOpts = { ...(opts ?? {}), order: ('DESC' as 'DESC') }
        this.orderBy(col, subOpts);
    }

    /**
     * `LIMIT [expr]
     */
    limit(expr: Expr<Ext> | number) {
        const lim = typeof expr === 'number' ? Lit(NumLit(expr)) : expr
        return new QueryBuilder<Schema, Table, Tn, Return, Ext>(
            lens<Query>().limit.set(() => lim)(this._query),
            this.fn
        );
    }

    /**
     * `OFFSET [expr]
     */
    offset(expr: Expr<Ext> | number) {
        const off = typeof expr === 'number' ? Lit(NumLit(expr)) : expr
        return new QueryBuilder<Schema, Table, Tn, Return, Ext>(
            lens<Query>().offset.set(() => off)(this._query),
            this.fn
        );
    }

    /**
     * Removes all type information from the builder allowing you to select whatever
     * you want and get back the any type. This should never be necessary as the SIJ
     * builder includes a complete typing of SQL but in situations where SIJ has a bug
     * you can continue using it while waiting for the upstream to be fixed.
     */
    unTyped(): QueryBuilder<any, any, any, any, Ext> {
        return this;
    }

    /** Method used in the tsd tests */
    __testingGet(): Return {
        throw new Error('Do not call this method, it only exists for testing');
    }
}
// Merges with above class to provide calling as a function
interface QueryBuilder<Schema, Table, Tn extends ((keyof Schema) & string), Return, Ext extends Extension = NoExtension> {
    <T>(fn: (arg: QueryBuilder<Schema, Table, Tn, Return, Ext>) => T): T
}

class InsertBuilder<Schema, Table,  Tn extends ((keyof Schema) & string), Ext extends Extension = NoExtension> {
    values(...vs: Array<{ [Key in keyof Table]?: Table[Key] }>) {
    }
}

type MySchema = {
    employee: {
        id: number,
        name: string,
    },
    department: {
        id: number,
        budget: number,
    },
};


const b = new Builder<MySchema, NoExtension>();

/*
const ggg: { name: string, id: number, asc: string } = b.from('employee')
    .select('employee.name', 'employee.id')
    .select(b.as('asc', ascii<MySchema, NoExtension>('name'))).__testingGet()
*/
b.from('employee').leftJoin('department', b => b.fn.eq('department.id', 'employee.id')).select('department.budget', 'employee.id')

//const foo: { name: string } = b.from('employee').select('name').__testingGet();

//const ssss: { name: string, id: number } = b.from('employee').select('employee.name', 'employee.id').__testingGet()

const bar = b.from('employee').select('id', 'name')(b => b.selectAs('name_length', b.fn.charLength('name')))

export {
    Builder
};
