import CallableInstance from 'callable-instance';
import { BuilderExtension, DataTypeToJs, TypeTag, TypedAst, makeLit, typeTag } from './util';
import {
  ColumnConstraintDefinition,
  ColumnDefinition,
  DefaultOption,
  Expr,
  Ident,
  SchemaDefinition,
  SchemaDefinitionStatement,
  SchemaManipulationStatement,
  TableConstraint,
  TableDefinition,
} from 'ast';
import { Extension } from 'ast/util';
import { Functions } from './functions';
import { DataType } from 'ast/data-type';
import { ColumnNotNull, NullDefault, UniqueConstraint } from 'ast/schema-definition';

type SchemaStatement<Ext extends Extension> = SchemaDefinitionStatement<Ext> | SchemaManipulationStatement<Ext>;

/*
sql.schema.table(...).domain(...).view();

ts-toolbelt pipe might be useful here
schema :: ([A, B]) => A & B
schema :: <A1, A2, F1 extends A1 => A2, F2 extends 
schema([
    sql.createTable('myTable', {
        columns: [
            {
                name: 'foo',
                type: sql.type.int,
                default: sql.fn.currentUser
                constraints: 'PRIMARY KEY'
            },
            {
                name: 'bar',
                type: sql.type.int,
                default: sql.lit(4)
                constraints: 'NOT NULL'
            },
            {
                name: 'baz',
                type: sql.type.int,
                default: sql.fn.currentUser
                constraints: sql.constraint.notNull
            },
            {
                name: 'baz2',
                type: sql.type.int,
                default: sql.fn.currentUser
                constraints: sql.constraint.check(sql.from(...)
                collation: "latin1"
            },
            {
                name: 'baz2',
                type: sql.type.int,
                default: sql.fn.currentUser
                constraints: sql.constraint.references('otherTable', {
                    ...
                })
            }
        ]
    })
])

name: Ident;
      readonly type: DataType | Ident; // Data type or domain identifier
      readonly default: DefaultOption;
      readonly constraints: Array<ColumnConstraintDefinition>;
      readonly collation: Ident | null; // TODO qualify

Utility type for converting tuple types to object types
*/

type SchemaArgs<Ext extends Extension> = {
  catalog?: string;
  authorization?: string;
  characterSet?: string;
};
type TableArgs = {
  local?: boolean;
  temporary?: boolean;
  columns: {
    [C in string]: ColumnArgs<any>;
  };
  constraints?: Array<TableConstraint>;
  onCommit?: 'Delete' | 'Preserve';
};
type ColumnArgs<T extends DataType | string> = {
  type: T; // Data type or domain identifier
  default?: DefaultOption | null;
  constraints?: Array<ConstraintArg> | ConstraintArg;
  collation?: string;
};
type ColumnsToTable<Cs extends { [k: string]: ColumnArgs<any> }> = {
  [K in keyof Cs]: Cs[K] extends ColumnArgs<infer T> ? (T extends DataType ? DataTypeToJs<T> : never) : never;
};

type ConstraintArg =
  | ColumnConstraintDefinition
  | 'NOT NULL'
  | 'not null'
  | 'UNIQUE'
  | 'unique'
  | 'PRIMARY KEY'
  | 'primary key';

/**
 * Builds a SELECT statement.
 */
class SchemaBuilder<Database, Return, Ext extends BuilderExtension> extends CallableInstance<Array<never>, unknown> {
  constructor(
    readonly _statements: Array<SchemaStatement<Ext>>,
    readonly fn: Functions<Database, never, Ext>,
  ) {
    super('apply');
  }

  apply<T>(fn: (arg: SchemaBuilder<Database, Return, Ext>) => T): T {
    return fn(this);
  }

  /**
   * Allows you to insert a literal into a query.
   */
  lit<Return extends number | string | boolean | null>(l: Return): TypedAst<Database, Return, Expr<Ext>> {
    return {
      ast: makeLit(l),
    } as TypedAst<Database, Return, Expr<Ext>>;
  }

  /*
  TODO I need to rewrite how the Schema is represented to account for schemas
  createSchema<N extends string>(
    name: N,
    opts: SchemaArgs<Ext> = {},
  ): SchemaBuilder<Database & { schemae: { [P in N]: null } }, Return, Ext> {
    const def = SchemaDefinition<Ext>({
        name: Ident(name),
        catalog: opts.catalog !== undefined ? Ident(opts.catalog) : null,
        authorization: opts.authorization !== undefined ? Ident(opts.authorization) : null,
        characterSet: opts.characterSet !== undefined ? Ident(opts.characterSet) : null,
        definitions: [],
        extensions: null,
    })
    return new SchemaBuilder<Database & { schemae: { [P in N]: null } }, Return, Ext>(
        [def, ...this._statements],
        this.fn as Functions<Database & { schemae: { [P in N]: null } }, any, Ext>,
      );
  }
  */
  createTable<N extends string, T extends TableArgs>(
    name: N,
    opts: T,
  ): SchemaBuilder<Database & { [P in N]: ColumnsToTable<T['columns']> }, Return, Ext> {
    const mode = opts.local ? 'LocalTemp' : opts.temporary ? 'GlobalTemp' : 'Persistent';
    const columns: Array<ColumnDefinition<Ext>> = Object.keys(opts.columns).map(colName => {
      const col = opts.columns[colName];
      const typ = typeof col.type === 'string' ? Ident(col.type) : col.type;
      const def = col.default === null ? NullDefault : col.default === undefined ? null : col.default;
      const makeConstraint = (con: ConstraintArg) => {
        if (typeof con !== 'string') {
          return con;
        }
        switch (con) {
          case 'not null':
          case 'NOT NULL':
            return ColumnConstraintDefinition({ name: null, constraint: ColumnNotNull, attributes: null });
          case 'unique':
          case 'UNIQUE':
            return ColumnConstraintDefinition({
              name: null,
              constraint: UniqueConstraint({ primaryKey: false, columns: [] }),
              attributes: null,
            });
          case 'primary key':
          case 'PRIMARY KEY':
            return ColumnConstraintDefinition({
              name: null,
              constraint: UniqueConstraint({ primaryKey: true, columns: [] }),
              attributes: null,
            });
        }
      };
      const constraints = (() => {
        if (col.constraints === undefined) {
          return [];
        }
        if (Array.isArray(col.constraints)) {
          return col.constraints.map(makeConstraint);
        }
        return [makeConstraint(col.constraints)];
      })();
      const collation = col.collation === undefined ? null : Ident(col.collation);
      return ColumnDefinition({
        name: Ident(colName),
        type: typ,
        default: def,
        constraints,
        collation,
        extensions: null,
      });
    });
    const def = TableDefinition<Ext>({
      name: Ident(name),
      mode: mode,
      columns: columns,
      constraints: opts.constraints ?? [],
      onCommit: opts.onCommit ?? null,
      extensions: null,
    });
    return new SchemaBuilder<Database & { [P in N]: ColumnsToTable<T['columns']> }, Return, Ext>(
      [...this._statements, def],
      this.fn as Functions<Database & { [P in N]: ColumnsToTable<T['columns']> }, any, Ext>,
    );
  }

  schemaTag(): TypeTag<Database> {
    return typeTag<Database>();
  }
}

// Merges with above class to provide calling as a function
interface SchemaBuilder<Database, Return, Ext extends BuilderExtension> {
  <T>(fn: (arg: SchemaBuilder<Database, Return, Ext>) => T): T;
}

export { SchemaBuilder };
