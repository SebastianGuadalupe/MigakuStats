type LogLevel = 'info' | 'warn' | 'error' | 'debug';

interface LogConfig {
  level: LogLevel;
  component?: string;
  bgColor: string;
  textColor: string;
}

const configs: Record<LogLevel, Omit<LogConfig, 'component'>> = {
  info: {
    level: 'info',
    bgColor: '#3498db',
    textColor: '#ffffff',
  },
  warn: {
    level: 'warn',
    bgColor: '#f39c12',
    textColor: '#ffffff',
  },
  error: {
    level: 'error',
    bgColor: '#e74c3c',
    textColor: '#ffffff',
  },
  debug: {
    level: 'debug',
    bgColor: '#613075',
    textColor: '#ffffff',
  },
};

function getCallerComponent(): string {
  const stack = new Error().stack;
  if (!stack) return 'Unknown';

  const stackLines = stack.split('\n');
  
  for (let i = 0; i < stackLines.length; i++) {
    const line = stackLines[i];
    
    if (line.includes('logger.ts')) continue;
    
    const vueMatches = [
      line.match(/\(([^)]*\.vue[^:)]*)(?::\d+:\d+)?\)/),  // (App.vue?hash:5:15)
      line.match(/@([^)]*\.vue[^:)]*)(?::\d+:\d+)?/),     // @App.vue?hash:5:15
      line.match(/(\w+\.vue)/),                           // App.vue
      line.match(/(\w+\.vue[?:])/),                       // App.vue? or App.vue:
    ];
    
    for (const match of vueMatches) {
      if (match) {
        const filePath = match[1];
        const fileName = filePath.split('/').pop()?.split('\\').pop() || filePath;
        const cleanFileName = fileName.split('?')[0].split(':')[0];
        const componentName = cleanFileName.replace('.vue', '');
        if (componentName) return componentName;
      }
    }
    
    if (line.includes('Object.') || line.includes('Array.') || line.includes('<anonymous>') || line.includes('eval')) continue;
    
    const functionMatch = line.match(/at\s+(?:async\s+)?([A-Z][a-zA-Z0-9_$]+)/);
    if (functionMatch) {
      const funcName = functionMatch[1];
      const skipList = ['Object', 'Array', 'Promise', 'String', 'Number', 'Boolean', 'Date', 'RegExp', 'Error', 'Function'];
      if (!skipList.includes(funcName)) {
        return funcName;
      }
    }
  }
  
  return 'Unknown';
}

function createLogger(componentName?: string) {
  const log = (level: LogLevel, ...args: any[]) => {
    const caller = componentName || getCallerComponent();
    const config = configs[level];
    
    const header = `%cMCS ${caller}`;
    const message = args.length === 1 ? args[0] : args;
    
    console.log(
      header,
      `background: ${config.bgColor}; color: ${config.textColor}; padding: 2px 6px; border-radius: 3px; font-weight: bold;`,
      message
    );
  };

  return {
    log,
    info: (...args: any[]) => log('info', ...args),
    warn: (...args: any[]) => log('warn', ...args),
    error: (...args: any[]) => log('error', ...args),
    debug: (...args: any[]) => log('debug', ...args),
  };
}

export const logger = createLogger();

export const useLogger = (componentName: string) => createLogger(componentName);

