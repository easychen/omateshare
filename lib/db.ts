import { neon } from "@neondatabase/serverless"
import { nanoid } from "nanoid"

// 初始化数据库连接
let sqlClient: any = null

// 检查环境变量是否存在
if (typeof window === 'undefined' && process.env.DATABASE_URL) {
  try {
    sqlClient = neon(process.env.DATABASE_URL)
    console.log("数据库连接初始化成功")
    
    // 添加数据库结构检查和初始化
    checkAndInitDatabase().catch(err => {
      console.error("数据库初始化检查失败:", err)
    })
  } catch (error) {
    console.error("数据库连接初始化失败:", error)
  }
} else if (typeof window === 'undefined') {
  console.warn("DATABASE_URL 环境变量未设置，数据库功能将不可用")
}

// 检查数据库结构并初始化
async function checkAndInitDatabase() {
  try {
    console.log("正在检查数据库结构...")
    
    // 检查contents表是否存在
    const tableExists = await sqlClient`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public'
        AND table_name = 'contents'
      ) as exists
    `
    
    if (tableExists[0]?.exists) {
      console.log("数据库结构已存在，无需初始化")
      return
    }
    
    console.log("数据库表不存在，开始初始化...")
    
    try {
      // 如果在服务器端，使用API路由初始化数据库
      if (typeof window === 'undefined') {
        // 使用fetch调用API路由
        const response = await fetch(`${process.env.NEXT_PUBLIC_URL || process.env.VERCEL_URL || 'http://localhost:3000'}/api/init-db`);
        
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(`API初始化失败: ${errorData.message || response.statusText}`);
        }
        
        const data = await response.json();
        console.log("数据库API初始化结果:", data);
      }
    } catch (error) {
      console.error("通过API初始化数据库失败:", error);
      
      // 尝试直接执行SQL语句的方式（备用方案）
      try {
        // 动态导入fs和path模块（只在服务器端）
        const { readFileSync, existsSync } = await import('fs');
        const { join } = await import('path');
        
        // 读取schema.sql文件
        const schemaPath = join(process.cwd(), 'scripts', 'schema.sql');
        
        // 检查文件是否存在
        if (!existsSync(schemaPath)) {
          console.error("未找到schema.sql文件，无法初始化数据库");
          return;
        }
        
        try {
          // 手动执行特定的表创建SQL语句
          // 1. 创建content_type枚举类型
          await sqlClient`
            DO $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'content_type') THEN
                    CREATE TYPE content_type AS ENUM (
                      'character_card',
                      'knowledge_base',
                      'event_book',
                      'prompt_injection',
                      'story_book',
                      'other'
                    );
                END IF;
            END$$;
          `;
          
          // 2. 创建contents表
          await sqlClient`
            CREATE TABLE IF NOT EXISTS contents (
              id SERIAL PRIMARY KEY,
              uuid VARCHAR(36) UNIQUE,
              name VARCHAR(255) NOT NULL,
              description TEXT,
              content_type content_type NOT NULL,
              blob_url TEXT NOT NULL,
              thumbnail_url TEXT,
              metadata JSONB,
              tags TEXT[],
              created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
              updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
          `;
          
          // 3. 创建access_logs表
          await sqlClient`
            CREATE TABLE IF NOT EXISTS access_logs (
              id SERIAL PRIMARY KEY,
              content_id INTEGER REFERENCES contents(id),
              access_type VARCHAR(50) NOT NULL,
              ip_address VARCHAR(100),
              user_agent TEXT,
              created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
          `;
          
          // 4. 创建site_settings表
          await sqlClient`
            CREATE TABLE IF NOT EXISTS site_settings (
              id SERIAL PRIMARY KEY,
              site_name VARCHAR(255) DEFAULT 'OMateShare',
              show_download_link BOOLEAN DEFAULT true,
              page_title VARCHAR(255) DEFAULT 'OMateShare',
              meta_description TEXT DEFAULT '管理角色卡、知识库、事件书和提示注入',
              created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
              updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
          `;
          
          // 5. 检查site_settings表是否有记录，没有则插入默认记录
          const settingsExist = await sqlClient`
            SELECT COUNT(*) FROM site_settings
          `;
          
          if (parseInt(settingsExist[0].count) === 0) {
            await sqlClient`
              INSERT INTO site_settings (site_name, show_download_link, page_title, meta_description)
              VALUES ('OMateShare', true, 'OMateShare', '管理角色卡、知识库、事件书和提示注入')
            `;
          }
          
          // 6. 创建索引
          await sqlClient`CREATE INDEX IF NOT EXISTS idx_contents_content_type ON contents(content_type);`;
          await sqlClient`CREATE INDEX IF NOT EXISTS idx_access_logs_content_id ON access_logs(content_id);`;
          await sqlClient`CREATE INDEX IF NOT EXISTS idx_contents_created_at ON contents(created_at);`;
          await sqlClient`CREATE INDEX IF NOT EXISTS idx_contents_updated_at ON contents(updated_at);`;
          
          console.log("执行SQL脚本成功");
        } catch (err) {
          console.error("SQL执行失败:", err);
          throw err;
        }
      } catch (fsError) {
        console.error("备用初始化方法也失败:", fsError);
        throw fsError;
      }
    }
    
    console.log("数据库自动初始化完成！");
  } catch (error) {
    console.error("数据库自动初始化失败:", error);
    throw error;
  }
}

// 内容类型枚举
export enum ContentType {
  CHARACTER_CARD = "character_card",
  KNOWLEDGE_BASE = "knowledge_base",
  EVENT_BOOK = "event_book",
  PROMPT_INJECTION = "prompt_injection",
  STORY_BOOK = "story_book",
  OTHER = "other",
}

// 内容查询函数
export async function getContents(type?: ContentType) {
  try {
    if (!sqlClient) {
      throw new Error("数据库连接未初始化")
    }

    if (type) {
      return await sqlClient`
        SELECT * FROM contents 
        WHERE content_type = ${type} 
        ORDER BY sort_order ASC NULLS LAST, updated_at DESC
      `
    } else {
      return await sqlClient`
        SELECT * FROM contents 
        ORDER BY sort_order ASC NULLS LAST, updated_at DESC
      `
    }
  } catch (error) {
    console.error("获取内容失败:", error)
    throw error
  }
}

// 获取单个内容
export async function getContent(id: number) {
  try {
    if (!sqlClient) {
      throw new Error("数据库连接未初始化")
    }

    console.log(`获取内容ID: ${id}`);
    
    const result = await sqlClient`
      SELECT * FROM contents 
      WHERE id = ${id}
    `
    console.log("getContent 结果:", result);
    
    if (Array.isArray(result) && result.length > 0) {
      return result[0];
    }
    return null;
  } catch (error) {
    console.error("获取内容详情失败:", error)
    throw error
  }
}

// 创建内容
export async function createContent(data: {
  name: string
  description?: string
  content_type: ContentType
  blob_url: string
  thumbnail_url?: string
  metadata?: any
  tags?: string[]
}) {
  try {
    if (!sqlClient) {
      console.error("数据库连接未初始化，无法创建内容")
      throw new Error("数据库连接未初始化")
    }

    const name = data.name
    const description = data.description || ""
    const content_type = data.content_type
    const blob_url = data.blob_url
    const thumbnail_url = data.thumbnail_url || null
    const metadata = data.metadata ? JSON.stringify(data.metadata) : null
    const tags = data.tags || []
    const uuid = nanoid(21) // 生成唯一ID
    
    // 确保标签是正确的格式，PostgreSQL 数组格式为 {item1,item2,item3}
    // 直接将 JavaScript 数组转换为 PostgreSQL 数组格式
    console.log("原始标签数组:", tags);

    console.log("创建内容参数:", {
      uuid,
      name,
      description,
      content_type,
      blob_url,
      thumbnail_url,
      metadata,
      tags
    })

    // 使用标签模板语法，传递 JavaScript 数组，让 neon 库处理类型转换
    const result = await sqlClient`
      INSERT INTO contents (
        uuid, name, description, content_type, blob_url, 
        thumbnail_url, metadata, tags
      )
      VALUES (
        ${uuid},
        ${name}, 
        ${description}, 
        ${content_type}, 
        ${blob_url}, 
        ${thumbnail_url}, 
        ${metadata}, 
        ${tags}
      )
      RETURNING *
    `
    
    console.log("数据库插入结果:", result);
    
    // 确保返回第一项结果
    if (Array.isArray(result) && result.length > 0) {
      return result[0];
    } else {
      console.error("数据库没有返回预期的插入结果");
      return {
        id: Date.now(), // 临时ID
        uuid,
        name,
        description,
        content_type,
        blob_url,
        thumbnail_url,
        metadata,
        tags,
        created_at: new Date(),
        updated_at: new Date()
      };
    }
  } catch (error) {
    console.error("创建内容失败:", error)
    throw error
  }
}

// 更新标签字段
const updateTags = async (id: number, tags: string[]) => {
  console.log(`更新标签: ${id}, 标签:`, tags);
  
  const result = await sqlClient`
    UPDATE contents
    SET tags = ${tags}, updated_at = CURRENT_TIMESTAMP
    WHERE id = ${id}
    RETURNING *
  `
  
  console.log(`更新标签结果:`, result);
  
  if (Array.isArray(result) && result.length > 0) {
    return result[0];
  }
  return null;
}

// 更新内容
export async function updateContent(
  id: number,
  data: {
    name?: string
    description?: string
    blob_url?: string
    thumbnail_url?: string
    metadata?: any
    tags?: string[]
  },
) {
  try {
    if (!sqlClient) {
      throw new Error("数据库连接未初始化")
    }

    console.log(`更新内容ID: ${id}, 数据:`, data);
    
    // 由于neon不支持动态字段名使用标签模板，我们需要为每种可能的组合创建查询
    // 这不是理想的做法，但对于有限的字段组合是可行的
    
    // 创建单个字段更新查询的辅助函数
    const updateSingleField = async (fieldName: string, value: any) => {
      console.log(`尝试更新字段: ${fieldName}, 值:`, value);
      
      let result;
      
      if (fieldName === 'name') {
        result = await sqlClient`
          UPDATE contents
          SET name = ${value}, updated_at = CURRENT_TIMESTAMP
          WHERE id = ${id}
          RETURNING *
        `
      } else if (fieldName === 'description') {
        result = await sqlClient`
          UPDATE contents
          SET description = ${value}, updated_at = CURRENT_TIMESTAMP
          WHERE id = ${id}
          RETURNING *
        `
      } else if (fieldName === 'blob_url') {
        result = await sqlClient`
          UPDATE contents
          SET blob_url = ${value}, updated_at = CURRENT_TIMESTAMP
          WHERE id = ${id}
          RETURNING *
        `
      } else if (fieldName === 'thumbnail_url') {
        result = await sqlClient`
          UPDATE contents
          SET thumbnail_url = ${value}, updated_at = CURRENT_TIMESTAMP
          WHERE id = ${id}
          RETURNING *
        `
      } else if (fieldName === 'metadata') {
        const jsonValue = value ? JSON.stringify(value) : null
        result = await sqlClient`
          UPDATE contents
          SET metadata = ${jsonValue}, updated_at = CURRENT_TIMESTAMP
          WHERE id = ${id}
          RETURNING *
        `
      } else if (fieldName === 'tags') {
        // 对标签进行特殊处理，使用单独的函数
        return await updateTags(id, value);
      }
      
      console.log(`更新字段 ${fieldName} 结果:`, result);
      
      if (Array.isArray(result) && result.length > 0) {
        return result[0];
      }
      return null;
    }
    
    // 记录最后一次更新的结果
    let latestResult = null;
    
    // 更新所有提供的字段，不再提前返回
    for (const field of ['name', 'description', 'blob_url', 'thumbnail_url', 'metadata', 'tags']) {
      if (data[field as keyof typeof data] !== undefined) {
        const result = await updateSingleField(field, data[field as keyof typeof data])
        if (result) {
          latestResult = result;
        }
      }
    }
    
    // 获取最新的更新后的内容
    if (latestResult) {
      const refreshedContent = await getContent(id);
      return refreshedContent || latestResult;
    }
    
    return null
  } catch (error) {
    console.error("更新内容失败:", error)
    throw error
  }
}

// 删除内容
export async function deleteContent(id: number) {
  try {
    if (!sqlClient) {
      throw new Error("数据库连接未初始化")
    }

    console.log(`删除内容ID: ${id}`);
    
    // 先删除关联的访问日志记录
    console.log(`删除关联的访问日志记录...`);
    await sqlClient`
      DELETE FROM access_logs 
      WHERE content_id = ${id}
    `;
    
    // 然后删除内容本身
    const result = await sqlClient`
      DELETE FROM contents 
      WHERE id = ${id} 
      RETURNING *
    `;
    
    console.log("删除内容结果:", result);
    
    if (Array.isArray(result) && result.length > 0) {
      return result[0];
    }
    return null;
  } catch (error) {
    console.error("删除内容失败:", error)
    throw error
  }
}

// 记录访问日志
export async function logAccess(data: {
  content_id: number
  access_type: string
  ip_address?: string
  user_agent?: string
}) {
  try {
    // 检查环境变量是否启用访问日志
    if (process.env.ACCESS_LOG_ON !== "1") {
      console.log("访问日志功能未启用，跳过记录");
      return null;
    }
    
    if (!sqlClient) {
      throw new Error("数据库连接未初始化")
    }

    const content_id = data.content_id
    const access_type = data.access_type
    const ip_address = data.ip_address || null
    const user_agent = data.user_agent || null

    console.log("记录访问日志:", data);
    
    const result = await sqlClient`
      INSERT INTO access_logs (
        content_id, access_type, ip_address, user_agent
      )
      VALUES (
        ${content_id}, ${access_type}, ${ip_address}, ${user_agent}
      )
      RETURNING id
    `
    
    console.log("记录访问日志结果:", result);
    
    if (Array.isArray(result) && result.length > 0) {
      return result[0];
    }
    return null;
  } catch (error) {
    console.error("记录访问日志失败:", error)
    // 访问日志失败不应影响主要功能
    return null
  }
}

// 站点设置类型定义
export interface SiteSettings {
  id: number;
  site_name: string;
  show_download_link: boolean;
  page_title: string;
  meta_description: string;
  created_at: Date;
  updated_at: Date;
}

// 获取站点设置
export async function getSiteSettings(): Promise<SiteSettings | null> {
  try {
    if (!sqlClient) {
      throw new Error("数据库连接未初始化")
    }

    const result = await sqlClient`
      SELECT * FROM site_settings 
      ORDER BY id ASC 
      LIMIT 1
    `;
    
    if (Array.isArray(result) && result.length > 0) {
      // 确保布尔值类型正确
      const settings = result[0];
      return {
        ...settings,
        show_download_link: Boolean(settings.show_download_link)
      };
    }
    
    // 如果没有记录，返回默认值
    return null;
  } catch (error) {
    console.error("获取站点设置失败:", error)
    throw error
  }
}

// 更新站点设置
export async function updateSiteSettings(data: {
  site_name?: string;
  show_download_link?: boolean;
  page_title?: string;
  meta_description?: string;
}): Promise<SiteSettings | null> {
  try {
    if (!sqlClient) {
      throw new Error("数据库连接未初始化")
    }

    // 获取当前设置ID
    const currentSettings = await getSiteSettings();
    const id = currentSettings?.id || 1;
    
    console.log("更新站点设置ID:", id, "数据:", data);
    
    // 构建更新SQL
    let updateFields = [];
    let values: any[] = [];
    
    if (data.site_name !== undefined) {
      updateFields.push("site_name = $1");
      values.push(data.site_name);
    }
    
    if (data.show_download_link !== undefined) {
      updateFields.push("show_download_link = $" + (values.length + 1));
      values.push(data.show_download_link);
    }
    
    if (data.page_title !== undefined) {
      updateFields.push("page_title = $" + (values.length + 1));
      values.push(data.page_title);
    }
    
    if (data.meta_description !== undefined) {
      updateFields.push("meta_description = $" + (values.length + 1));
      values.push(data.meta_description);
    }
    
    if (updateFields.length === 0) {
      return currentSettings;
    }
    
    // 添加更新时间
    updateFields.push("updated_at = CURRENT_TIMESTAMP");
    
    // 使用neon的标签模板语法构建查询
    const query = `
      UPDATE site_settings
      SET ${updateFields.join(", ")}
      WHERE id = ${id}
      RETURNING *
    `;
    
    // 根据提供的字段构建查询
    let result;
    if (data.site_name !== undefined && data.show_download_link !== undefined && 
        data.page_title !== undefined && data.meta_description !== undefined) {
      result = await sqlClient`
        UPDATE site_settings
        SET site_name = ${data.site_name}, 
            show_download_link = ${data.show_download_link},
            page_title = ${data.page_title},
            meta_description = ${data.meta_description},
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ${id}
        RETURNING *
      `;
    } else if (data.site_name !== undefined) {
      result = await sqlClient`
        UPDATE site_settings
        SET site_name = ${data.site_name},
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ${id}
        RETURNING *
      `;
    } else if (data.show_download_link !== undefined) {
      result = await sqlClient`
        UPDATE site_settings
        SET show_download_link = ${data.show_download_link},
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ${id}
        RETURNING *
      `;
    } else if (data.page_title !== undefined) {
      result = await sqlClient`
        UPDATE site_settings
        SET page_title = ${data.page_title},
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ${id}
        RETURNING *
      `;
    } else if (data.meta_description !== undefined) {
      result = await sqlClient`
        UPDATE site_settings
        SET meta_description = ${data.meta_description},
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ${id}
        RETURNING *
      `;
    }
    
    console.log("更新站点设置结果:", result);
    
    if (Array.isArray(result) && result.length > 0) {
      const settings = result[0];
      return {
        ...settings,
        show_download_link: Boolean(settings.show_download_link)
      };
    }
    
    return null;
  } catch (error) {
    console.error("更新站点设置失败:", error)
    throw error
  }
}

// 根据ID数组批量获取内容
export async function getContentsByIds(ids: string[]) {
  try {
    if (!sqlClient) {
      throw new Error("数据库连接未初始化")
    }
    
    if (!ids || ids.length === 0) {
      console.log("批量获取内容: 没有提供ID")
      return []
    }

    // 将字符串ID转换为数字ID
    const numericIds = ids.map(id => parseInt(id)).filter(id => !isNaN(id))
    
    if (numericIds.length === 0) {
      console.log("批量获取内容: 没有有效的数字ID")
      return []
    }
    
    console.log(`批量获取内容: 查询ID ${numericIds.join(', ')}`)

    // 使用ANY操作符代替IN
    const result = await sqlClient`
      SELECT * FROM contents 
      WHERE id = ANY(${numericIds})
    `
    
    console.log(`批量获取内容结果: 找到 ${result.length} 条记录`)
    return result
  } catch (error) {
    console.error("批量获取内容失败:", error)
    throw error
  }
}

// 更新内容排序顺序
export async function updateContentSortOrder(id: number, sortOrder: number) {
  try {
    if (!sqlClient) {
      throw new Error("数据库连接未初始化")
    }

    console.log(`更新内容排序: ID=${id}, 排序值=${sortOrder}`);
    
    const result = await sqlClient`
      UPDATE contents
      SET sort_order = ${sortOrder}, updated_at = CURRENT_TIMESTAMP
      WHERE id = ${id}
      RETURNING *
    `
    
    console.log("更新排序结果:", result);
    
    if (Array.isArray(result) && result.length > 0) {
      return result[0];
    }
    return null;
  } catch (error) {
    console.error("更新内容排序失败:", error)
    throw error
  }
}
