/** ELK's bundled engine is third-party JavaScript; app-owned callers are checked. */
declare class ELK {
  layout(graph: object): Promise<{ children: {id:string;x:number;y:number}[]; edges: unknown[]; width:number; height:number }>;
}
export = ELK;
